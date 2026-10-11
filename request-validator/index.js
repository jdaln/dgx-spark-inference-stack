// Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
// Request validator. Resolves `model` to a container, asks the waker to start it, rewrites the
// request per the lane's models.json flags and proxies it. Busy and error responses from the
// waker go back to the client. Token budgeting is left to the engine.

import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { isOpenAIErrorEnvelope, makeOpenAIError, writeOpenAIError } from "../shared/error-response.mjs";
import { loadModelsConfig } from "../shared/models-config.mjs";

const PORT = Number(process.env.PORT || 18081);
// Matches the gateway's client_max_body_size 64m; direct callers get the same cap.
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 64 * 1024 * 1024);
const VERBOSE = (process.env.VERBOSE || "0") !== "0";
const WAKER_URL = process.env.WAKER_URL || "http://waker:18080";
// The waker's idle timer only sees request starts; long responses refresh it on this interval.
const TOUCH_INTERVAL_MS = Number(process.env.TOUCH_INTERVAL_MS || 60_000);
// Same key the model containers enforce, checked before a lane is woken. Empty disables it, as in vLLM.
const API_KEY_DIGEST = process.env.VLLM_API_KEY
  ? createHash("sha256").update(process.env.VLLM_API_KEY).digest()
  : null;
const MODELS_CONFIG_PATH = process.env.MODELS_CONFIG_PATH || "/config/models.json";
const MODELS_CONFIG = loadModelsConfig(MODELS_CONFIG_PATH);
const MODEL_CONFIG = Object.fromEntries(
  MODELS_CONFIG.entries.map((entry) => [
    entry.model,
    {
      modelId: entry.model,
      host: entry.container,
      port: entry.port,
      maxModelLen: entry.maxModelLen,
      toolSupport: entry.toolSupport,
      validatorProfile: entry.validatorProfile,
      thinkingDefault: entry.thinkingDefault,
      reasoningEffort: entry.reasoningEffort,
      reasoningEffortDefault: entry.reasoningEffortDefault,
      backend: entry.backend,
      lifecycle: entry.lifecycle,
      multimodal: entry.multimodal,
      normalizeTextContent: entry.normalizeTextContent,
      speculativeDecoding: entry.speculativeDecoding,
      reasoningNeedsSpecialTokens: entry.reasoningNeedsSpecialTokens
    }
  ])
);

function log(...args) {
  if (VERBOSE) console.log("[validator]", ...args);
}

function warn(...args) {
  console.warn("[validator]", ...args);
}

function shouldStripTools(targetConfig) {
  if (!targetConfig) return false;
  if (targetConfig.validatorProfile === "small-no-tools" || targetConfig.validatorProfile === "vl") {
    return true;
  }
  return targetConfig.toolSupport === "none";
}

function shouldForceToolChoice(targetConfig) {
  if (!targetConfig) return false;
  if (targetConfig.validatorProfile === "coder-force-tools") {
    return true;
  }
  return targetConfig.toolSupport === "force-required";
}

function shouldNormalizeTextContent(targetConfig) {
  if (!targetConfig) return false;
  if (targetConfig.multimodal) return false;
  return targetConfig.normalizeTextContent === true;
}

// vLLM silently ignores min_p and logit_bias under speculative decoding. Reject them instead.
// Neutral values (min_p 0, an empty logit_bias) pass.
function unsupportedSamplingParam(body, targetConfig) {
  if (!targetConfig?.speculativeDecoding) return null;
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof data.min_p === "number" && data.min_p > 0) return "min_p";
  if (data.logit_bias && typeof data.logit_bias === "object" && Object.keys(data.logit_bias).length > 0) return "logit_bias";
  return null;
}

// Engines measured to answer at full length when the client omits max_tokens. Add a backend
// only after measuring it.
const BACKEND_OWNS_TOKEN_BUDGET = new Set(["vllm", "sglang"]);

const RECOGNIZED_REASONING_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "auto"
]);

function getRequestedReasoningEffort(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  if (typeof data.reasoning_effort === "string") {
    return data.reasoning_effort.trim().toLowerCase();
  }

  if (typeof data.reasoningEffort === "string") {
    return data.reasoningEffort.trim().toLowerCase();
  }

  if (
    data.reasoning &&
    typeof data.reasoning === "object" &&
    !Array.isArray(data.reasoning) &&
    typeof data.reasoning.effort === "string"
  ) {
    return data.reasoning.effort.trim().toLowerCase();
  }

  return null;
}

function stripReasoningEffortFields(data) {
  delete data.reasoning_effort;
  delete data.reasoningEffort;

  if (data.reasoning && typeof data.reasoning === "object" && !Array.isArray(data.reasoning)) {
    const { effort, ...rest } = data.reasoning;
    if (effort !== undefined) {
      if (Object.keys(rest).length === 0) {
        delete data.reasoning;
      } else {
        data.reasoning = rest;
      }
    }
  }
}

// The Qwen3.8 chat template accepts only xhigh, medium and low and raises on any other
// effort, so a plain "high" would fail with a 400. Map the common vocabulary onto those levels.
const QWEN38_GRADED_REASONING = {
  off: new Set(["none"]),
  levels: new Map([
    ["minimal", "low"],
    ["low", "low"],
    ["medium", "medium"],
    ["high", "xhigh"],
    ["xhigh", "xhigh"],
    ["max", "xhigh"],
    ["auto", "xhigh"]
  ])
};

function applyGradedReasoningEffort(targetConfig, data) {
  if (targetConfig?.reasoningEffort !== "graded") {
    return;
  }

  const graded = QWEN38_GRADED_REASONING;

  const chatTemplateKwargs =
    data.chat_template_kwargs && typeof data.chat_template_kwargs === "object" && !Array.isArray(data.chat_template_kwargs)
      ? data.chat_template_kwargs
      : {};
  const explicitThinking = chatTemplateKwargs.enable_thinking !== undefined || chatTemplateKwargs.thinking !== undefined;

  // A lane may replace the template's default effort for callers that state none.
  let requested = getRequestedReasoningEffort(data);
  if (!requested && !explicitThinking && targetConfig.reasoningEffortDefault) {
    requested = targetConfig.reasoningEffortDefault;
    log(`Applying lane default reasoning_effort=${requested} for ${data.model}`);
  }
  if (!requested) {
    return;
  }

  // An explicit thinking flag from the caller wins over reasoning_effort.
  if (explicitThinking) {
    stripReasoningEffortFields(data);
    log(`Preserving explicit chat_template_kwargs thinking flags for ${data.model}; ignoring reasoning_effort=${requested}`);
    return;
  }

  stripReasoningEffortFields(data);

  if (graded.off.has(requested)) {
    data.chat_template_kwargs = { ...chatTemplateKwargs, enable_thinking: false, thinking: false };
    log(`Mapped reasoning_effort=${requested} to thinking=false for ${data.model}`);
    return;
  }

  const resolved = graded.levels.get(requested);
  if (!resolved) {
    log(`Dropping unsupported reasoning_effort=${requested} for ${data.model}; falling back to template default`);
    return;
  }

  data.reasoning_effort = resolved;
  if (resolved !== requested) {
    log(`Mapped reasoning_effort=${requested} to ${resolved} for ${data.model}`);
  }
}

function applyOpenCodeReasoningEffort(targetConfig, data) {
  const reasoningEffort = getRequestedReasoningEffort(data);
  if (!reasoningEffort) {
    return;
  }

  if (targetConfig?.reasoningEffort !== "binary") {
    return;
  }

  if (!RECOGNIZED_REASONING_EFFORTS.has(reasoningEffort)) {
    stripReasoningEffortFields(data);
    log(`Ignoring unsupported reasoning_effort=${reasoningEffort} for ${data.model}`);
    return;
  }

  const chatTemplateKwargs =
    data.chat_template_kwargs && typeof data.chat_template_kwargs === "object" && !Array.isArray(data.chat_template_kwargs)
      ? data.chat_template_kwargs
      : {};

  if (chatTemplateKwargs.enable_thinking !== undefined || chatTemplateKwargs.thinking !== undefined) {
    stripReasoningEffortFields(data);
    log(`Preserving explicit chat_template_kwargs thinking flags for ${data.model}; ignoring reasoning_effort=${reasoningEffort}`);
    return;
  }

  stripReasoningEffortFields(data);

  const enableThinking = reasoningEffort !== "none";
  data.chat_template_kwargs = {
    ...chatTemplateKwargs,
    enable_thinking: enableThinking,
    thinking: enableThinking
  };
  log(`Mapped reasoning_effort=${reasoningEffort} to chat_template_kwargs thinking=${enableThinking} for ${data.model}`);
}

// Gemma 4's reasoning parser needs its channel marker tokens, which non-streaming responses
// strip by default. Keep special tokens when thinking is on, unless the client chose.
function keepSpecialTokensForReasoning(targetConfig, data) {
  if (!targetConfig?.reasoningNeedsSpecialTokens || data.stream === true || data.skip_special_tokens !== undefined) {
    return;
  }
  const kwargs = data.chat_template_kwargs;
  if (kwargs && typeof kwargs === "object" && (kwargs.enable_thinking === true || kwargs.thinking === true)) {
    data.skip_special_tokens = false;
    log(`Kept special tokens so the reasoning parser can split thinking for ${data.model}`);
  }
}

function normalizeQwenThinkingFlag(targetConfig, data) {
  if (targetConfig?.reasoningEffort !== "binary") {
    return;
  }

  if (typeof data.thinking !== "boolean") {
    return;
  }

  const chatTemplateKwargs =
    data.chat_template_kwargs && typeof data.chat_template_kwargs === "object" && !Array.isArray(data.chat_template_kwargs)
      ? data.chat_template_kwargs
      : {};

  data.chat_template_kwargs = {
    ...chatTemplateKwargs,
    enable_thinking: chatTemplateKwargs.enable_thinking ?? data.thinking,
    thinking: chatTemplateKwargs.thinking ?? data.thinking
  };

  delete data.thinking;
  log(`Normalized top-level thinking into chat_template_kwargs for ${data.model}`);
}

function shouldDisableThinkingByDefault(targetConfig, data) {
  if (targetConfig?.thinkingDefault !== "off") {
    return false;
  }

  const chatTemplateKwargs = data.chat_template_kwargs;
  if (chatTemplateKwargs === undefined || chatTemplateKwargs === null) {
    return true;
  }

  if (typeof chatTemplateKwargs !== "object" || Array.isArray(chatTemplateKwargs)) {
    return true;
  }

  return chatTemplateKwargs.enable_thinking === undefined && chatTemplateKwargs.thinking === undefined;
}

function isAuthorized(req) {
  if (!API_KEY_DIGEST) return true;
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!match) return false;
  return timingSafeEqual(createHash("sha256").update(match[1].trim()).digest(), API_KEY_DIGEST);
}

function json(res, code, obj, headers = {}) {
  res.writeHead(code, { ...headers, "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function forwardedResponseHeaders(headers) {
  const forwardedHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    const k = key.toLowerCase();
    if (
      k === "retry-after" ||
      k === "x-time-until-release-sec" ||
      k.startsWith("x-dgx-") ||
      k.startsWith("x-busy-") ||
      k.startsWith("x-model-")
    ) {
      forwardedHeaders[key] = value;
    }
  }
  return forwardedHeaders;
}

function processBody(body, targetConfig, url) {
  try {
    const data = JSON.parse(body);

    // Some chat templates accept only string content, while OpenCode sends
    // [{"type": "text", "text": "Hi"}]. Join the text parts; images are dropped on text-only lanes.
    const needsContentNormalization = shouldNormalizeTextContent(targetConfig);
    if (needsContentNormalization && Array.isArray(data.messages)) {
      for (const msg of data.messages) {
        if (Array.isArray(msg.content)) {
          const textParts = msg.content
            .filter(part => part.type === "text" && part.text)
            .map(part => part.text);
          if (textParts.length > 0) {
            msg.content = textParts.join("\n");
            log(`Normalized array content to string for ${data.model}`);
          }
        }
      }
    }

    // Llama tool-calling guidance: raw JSON arguments, and no tool calls for plain conversation.
    // All other message structure belongs to the chat templates.
    if (targetConfig?.validatorProfile === "llama-tools" && Array.isArray(data.messages) && Array.isArray(data.tools) && data.tools.length > 0) {
      const toolInstruction = `CRITICAL INSTRUCTIONS:
1. When calling tools, you must provide array and object arguments as raw JSON values (e.g. [1, 2] or {"key": "value"}), NOT as JSON strings. Do not quote these values.
2. If the user greets you (e.g. "Hi", "Hello"), reply with text. Do NOT call tools unless specifically needed for a task.`;

      // After any leading system messages; the Llama template allows several.
      let insertAt = 0;
      while (insertAt < data.messages.length && data.messages[insertAt].role === "system") insertAt++;
      data.messages.splice(insertAt, 0, { role: "system", content: toolInstruction });
      log(`Injected strict tool instruction for Llama calling fix: ${data.model}`);

      const warnText = " (Provide as raw JSON, NOT a string)";

      const updateSchema = (schema) => {
        if (!schema || typeof schema !== 'object') return;

        if (schema.type === 'array' || schema.type === 'object') {
          if (schema.description && !schema.description.includes(warnText)) {
            schema.description += warnText;
          } else if (!schema.description) {
            schema.description = "Provide as raw JSON, NOT a string";
          }
        }

        if (schema.properties) {
          for (const key in schema.properties) {
            updateSchema(schema.properties[key]);
          }
        }
        if (schema.items) {
          updateSchema(schema.items);
        }
      };

      for (const tool of data.tools) {
        if (tool.function && tool.function.parameters) {
          updateSchema(tool.function.parameters);
        }
        // Llama calls the client's `question` tool even on greetings.
        if (tool.function && tool.function.name === 'question') {
          const hint = "Only use this tool if you need to gather specific information for a task. Do not use for general greetings.";
          tool.function.description = tool.function.description ? `${tool.function.description} ${hint}` : hint;
        }
      }
      log(`Rewrote tool descriptions for Llama model: ${data.model}`);
    }

    // max_tokens is left as the client sent it: the engine sizes the budget from the real
    // templated prompt. Warn for engines not known to do that.
    if (targetConfig && !BACKEND_OWNS_TOKEN_BUDGET.has(targetConfig.backend ?? "vllm")) {
      warn(
        `Model '${targetConfig.modelId}' runs on backend '${targetConfig.backend}', which has not been ` +
        `confirmed to compute its own output budget from the prompt. Requests that omit max_tokens may ` +
        `be truncated by the engine's own default. Verify before relying on this lane for long answers.`
      );
    }

    // OpenCode sends max_completion_tokens; vLLM reads max_tokens.
    // https://github.com/anomalyco/opencode/issues/9611
    if (data.max_completion_tokens !== undefined && data.max_tokens === undefined) {
      data.max_tokens = data.max_completion_tokens;
      log(`Normalized max_completion_tokens -> max_tokens (${data.max_tokens})`);
    }

    // Lanes without a tool parser.
    if (shouldStripTools(targetConfig)) {
      const toolParams = ["tool_choice", "tools", "functions", "function_call", "parallel_tool_calls"];
      for (const param of toolParams) {
        if (data[param] !== undefined) {
          log(`Stripping ${param} for ${data.model} (${targetConfig.validatorProfile})`);
          delete data[param];
        }
      }
    }

    // Lanes that ignore tools under "auto". Not after a tool result, so the model can answer.
    const hasToolResults = Array.isArray(data.messages) && data.messages.some(m => m.role === "tool");
    if (shouldForceToolChoice(targetConfig) && data.tools && data.tools.length > 0 && !hasToolResults) {
      if (!data.tool_choice || data.tool_choice === "auto") {
        data.tool_choice = "required";
        log(`Forced tool_choice to required for ${data.model} (${targetConfig.validatorProfile})`);
      }
    }

    normalizeQwenThinkingFlag(targetConfig, data);
    applyGradedReasoningEffort(targetConfig, data);
    applyOpenCodeReasoningEffort(targetConfig, data);

    if (shouldDisableThinkingByDefault(targetConfig, data)) {
      const chatTemplateKwargs =
        data.chat_template_kwargs && typeof data.chat_template_kwargs === "object" && !Array.isArray(data.chat_template_kwargs)
          ? data.chat_template_kwargs
          : {};
      data.chat_template_kwargs = {
        ...chatTemplateKwargs,
        enable_thinking: false,
        thinking: false
      };
      log(`Disabled thinking by default for ${data.model} to preserve visible final answers`);
    }

    keepSpecialTokensForReasoning(targetConfig, data);

    return JSON.stringify(data);
  } catch (e) {
    warn("Failed to parse or process JSON body:", e.message);
    return body;
  }
}

function isMainModule() {
  if (!process.argv[1]) {
    return false;
  }

  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const fail = (err) => {
      if (done) return;
      done = true;
      reject(err);
    };
    req.on("data", (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const err = new Error("request body too large");
        err.code = "body_too_large";
        fail(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", fail);
  });
}

// Drop hop-by-hop headers. The body is re-buffered, so content-length is recomputed.
const HOP_BY_HOP_HEADERS = new Set([
  "transfer-encoding",
  "connection",
  "keep-alive",
  "expect",
  "upgrade",
  "te",
  "trailer",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection"
]);

function forwardableRequestHeaders(headers) {
  const forwarded = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      forwarded[key] = value;
    }
  }
  return forwarded;
}

// node:http, not fetch: undici's 300 s headers timeout is shorter than a cold start.
function wakerEnsure(modelId, signal) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${WAKER_URL}/ensure/${encodeURIComponent(modelId)}`, { method: "POST", signal }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

function touchWaker(container) {
  fetch(`${WAKER_URL}/touch/${encodeURIComponent(container)}`, { method: "POST" })
    .then((r) => r.arrayBuffer())
    .catch((err) => log(`Waker touch failed for ${container}:`, err.message));
}

const MAX_UPSTREAM_ERROR_BYTES = 1024 * 1024;

function upstreamErrorType(status) {
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 404) return "not_found_error";
  if (status === 429) return "rate_limit_error";
  if (status === 503) return "service_unavailable_error";
  return status < 500 ? "invalid_request_error" : "api_error";
}

// Engines disagree on error bodies. Re-wrap them so clients get one envelope.
function forwardUpstreamError(proxyRes, res) {
  const chunks = [];
  let size = 0;
  proxyRes.on("data", (chunk) => {
    size += chunk.length;
    if (size <= MAX_UPSTREAM_ERROR_BYTES) chunks.push(chunk);
  });
  proxyRes.on("end", () => {
    const status = proxyRes.statusCode;
    const text = Buffer.concat(chunks).toString("utf8");
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { }
    const source = parsed?.error && typeof parsed.error === "object" ? parsed.error : parsed ?? {};
    const headers = {};
    for (const key of ["retry-after", "x-request-id"]) {
      if (proxyRes.headers[key]) headers[key] = proxyRes.headers[key];
    }
    writeOpenAIError(res, status, {
      message:
        (typeof source.message === "string" && source.message) ||
        (typeof parsed?.error === "string" && parsed.error) ||
        (typeof source.detail === "string" && source.detail) ||
        text.trim().slice(0, 500) ||
        `Upstream model service returned status ${status}.`,
      type: upstreamErrorType(status),
      param: source.param ?? null,
      code: typeof source.code === "string" ? source.code : "upstream_error"
    }, headers);
  });
}

function proxyRequest(req, res, body, target) {
  log(`Proxying to ${target.host}:${target.port}${req.url}`);
  const options = {
    hostname: target.host,
    port: target.port,
    path: req.url,
    method: req.method,
    headers: { ...forwardableRequestHeaders(req.headers), "content-length": Buffer.byteLength(body) },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    proxyRes.on("error", (err) => {
      warn(`Upstream response error from ${target.host}:`, err.message);
      res.destroy();
    });
    if (proxyRes.statusCode >= 400) {
      forwardUpstreamError(proxyRes, res);
      return;
    }
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on("error", (err) => {
    warn(`Proxy error to ${target.host}:`, err.message);
    if (res.headersSent) {
      // Response already streaming; too late for an error envelope.
      res.destroy();
      return;
    }
    writeOpenAIError(res, 502, {
      message: `Upstream model service for '${target.modelId}' is unavailable.`,
      type: "api_error",
      param: null,
      code: "upstream_unavailable"
    });
  });
  // The utility lane is never idle-stopped, so it needs no keep-alive.
  const keepAlive = target.lifecycle === "utility"
    ? null
    : setInterval(() => touchWaker(target.host), TOUCH_INTERVAL_MS);
  // Stop upstream generation when the client disconnects mid-response.
  res.on("close", () => {
    if (!res.writableEnded) proxyReq.destroy();
    if (keepAlive) {
      clearInterval(keepAlive);
      touchWaker(target.host);
    }
  });
  proxyReq.write(body);
  proxyReq.end();
}

const MODELS_LIST_RESPONSE = {
  object: "list",
  data: MODELS_CONFIG.entries.map((entry) => ({
    id: entry.model,
    object: "model",
    created: 0,
    owned_by: "dgx-spark"
  }))
};

const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz" && req.method === "GET") {
    return json(res, 200, { status: "ok" });
  }

  if (!isAuthorized(req)) {
    return writeOpenAIError(res, 401, {
      message: "Missing or invalid API key.",
      type: "authentication_error",
      param: null,
      code: "invalid_api_key"
    });
  }

  const pathname = req.url.split("?")[0];
  if (req.method === "GET" && pathname === "/v1/models") {
    return json(res, 200, MODELS_LIST_RESPONSE);
  }
  if (req.method === "GET" && pathname.startsWith("/v1/models/")) {
    let id = null;
    try { id = decodeURIComponent(pathname.slice("/v1/models/".length)); } catch { }
    const model = MODELS_LIST_RESPONSE.data.find((entry) => entry.id === id);
    if (model) return json(res, 200, model);
    return writeOpenAIError(res, 404, {
      message: `Model '${id ?? pathname}' is not configured in models.json.`,
      type: "not_found_error",
      param: "model",
      code: "model_not_found"
    });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    if (err.code === "body_too_large") {
      return writeOpenAIError(
        res,
        413,
        {
          message: `Request body exceeds the ${MAX_BODY_BYTES} byte limit.`,
          type: "invalid_request_error",
          param: null,
          code: "request_too_large"
        },
        { Connection: "close" }
      );
    }
    // Client aborted or socket error while uploading; nothing left to answer.
    res.destroy();
    return;
  }

  try {
    let modelId;
    if (req.method === "POST" && body) {
      try {
        modelId = JSON.parse(body).model;
      } catch {
        return writeOpenAIError(res, 400, {
          message: "Request body is not valid JSON.",
          type: "invalid_request_error",
          param: null,
          code: "invalid_json"
        });
      }
    }

    if (!modelId) {
      return writeOpenAIError(res, 400, {
        message: "Request body is missing required field 'model'.",
        type: "invalid_request_error",
        param: "model",
        code: "missing_model"
      });
    }

    const targetConfig = Object.hasOwn(MODEL_CONFIG, modelId) ? MODEL_CONFIG[modelId] : undefined;
    if (!targetConfig) {
      return writeOpenAIError(res, 404, {
        message: `Model '${modelId}' is not configured in models.json.`,
        type: "not_found_error",
        param: "model",
        code: "model_not_found"
      });
    }

    const unsupported = unsupportedSamplingParam(body, targetConfig);
    if (unsupported) {
      return writeOpenAIError(res, 400, {
        message: `Parameter '${unsupported}' is not supported by model '${modelId}': it runs speculative decoding, which ignores it.`,
        type: "invalid_request_error",
        param: unsupported,
        code: "unsupported_parameter"
      });
    }

    // 21 minutes, past the waker's 15-minute health wait.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1260000);
    // A client that leaves during a cold start must not have its request run afterwards.
    const abortOnClose = () => controller.abort();
    res.on("close", abortOnClose);

    let wakerRes;
    try {
      wakerRes = await wakerEnsure(modelId, controller.signal);
    } catch (err) {
      if (res.destroyed) return;
      clearTimeout(timeout);
      warn(`Waker fetch error for ${modelId}:`, err.message);
      return writeOpenAIError(res, 504, {
        message: `Waker service timed out or is unreachable while preparing model '${modelId}'.`,
        type: "api_error",
        param: null,
        code: "waker_timeout"
      });
    } finally {
      clearTimeout(timeout);
    }

    let wakerBody;
    try {
      wakerBody = JSON.parse(wakerRes.text);
    } catch (err) {
      if (res.destroyed) return;
      warn(`Failed to parse waker response for ${modelId}:`, err.message);
      return writeOpenAIError(res, 502, {
        message: `Waker service returned invalid JSON while preparing model '${modelId}'.`,
        type: "api_error",
        param: null,
        code: "waker_invalid_response"
      });
    }
    res.off("close", abortOnClose);
    if (res.destroyed) {
      log(`Client left while ${modelId} was starting; not proxying.`);
      return;
    }

    if (wakerRes.status !== 200 || !wakerBody.ok) {
      const forwardedHeaders = forwardedResponseHeaders(wakerRes.headers);

      log(`Model not ready, forwarding waker's response (Status: ${wakerRes.status})`);
      if (wakerRes.status !== 200 && !isOpenAIErrorEnvelope(wakerBody)) {
        wakerBody = makeOpenAIError({
          message: `Waker service returned status ${wakerRes.status} while preparing model '${modelId}'.`,
          type: "api_error",
          param: null,
          code: "waker_error"
        });
      }
      return json(res, wakerRes.status, wakerBody, forwardedHeaders);
    }

    log(`Model ${modelId} is ready, processing and proxying request.`);
    const processedBody = processBody(body, targetConfig, req.url);
    proxyRequest(req, res, processedBody, targetConfig);

  } catch (err) {
    warn("Main handler error:", err);
    writeOpenAIError(res, 500, {
      message: "Internal request-validator error.",
      type: "api_error",
      param: null,
      code: "internal_error"
    });
  }
});

export { processBody, unsupportedSamplingParam, MODEL_CONFIG };

if (isMainModule()) {
  server.setTimeout(0);
  server.listen(PORT, () => {
    log(`Request validator listening on port ${PORT}`);
    log(`Loaded models config from ${MODELS_CONFIG_PATH}`);
    log(`Configured models: ${Object.keys(MODEL_CONFIG).length}`);
  });
}
