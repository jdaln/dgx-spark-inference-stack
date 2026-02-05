// Request validator and router middleware.
// This service:
// 1. Reads the `model` from the request body to determine the target container.
// 2. Calls the `waker` service to ensure the requested model is running.
// 3. Forwards "busy" responses from the waker back to the client.
// 4. Normalizes `max_completion_tokens` to `max_tokens` (OpenCode vs vLLM compatibility).
// 5. Caps `max_tokens` to prevent context overflow (limits response length, NOT input prompt).
// 6. Normalizes multimodal content format for models with incompatible chat templates.
// 7. Strips tool parameters from models that don't support tool calling (small, VL, math).
// 8. Forces `tool_choice: required` for models that ignore tools with "auto" (Qwen3-Coder, Qwen2.5-Coder).
// 9. Fixes role alternation for Gemma/Llama models requiring strict user/assistant turns.
// 10. Proxies the final, validated request to the correct vLLM container.

import http from "node:http";

const PORT = Number(process.env.PORT || 18081);
const VERBOSE = (process.env.VERBOSE || "0") !== "0";
const WAKER_URL = process.env.WAKER_URL || "http://waker:18080";

// Model configuration: Maps the served model name to its container host and context window size.
const MODEL_CONFIG = {
  "gpt-oss-20b": { host: "vllm-oss20b", port: 8000, maxModelLen: 131072 },
  "gpt-oss-120b": { host: "vllm-oss120b", port: 8000, maxModelLen: 131072 },
  "qwen3-next-80b-a3b-instruct-fp4": { host: "vllm-qwen3-next-80b-fp4", port: 8000, maxModelLen: 131072 },
  "qwen3-next-80b-a3b-thinking-fp4": { host: "vllm-qwen3-next-80b-thinking-fp4", port: 8000, maxModelLen: 131072 },
  "qwen3-vl-32b-instruct-fp4": { host: "vllm-qwen3-vl-32b-fp4", port: 8000, maxModelLen: 131072 },
  "glm-4.5-air-fp4": { host: "vllm-glm-4.5-air-fp4", port: 8000, maxModelLen: 131072 },
  "glm-4.6v-flash-fp4": { host: "vllm-glm-4.6v-flash-fp4", port: 8000, maxModelLen: 131072 },
  "glm-4.5-air-derestricted-fp4": { host: "vllm-glm-4.5-air-derestricted-fp4", port: 8000, maxModelLen: 131072 },
  "llama-3.3-70b-joyous-fp4": { host: "vllm-llama-3.3-70b-joyous-fp4", port: 8000, maxModelLen: 131072 },
  "llama-3.3-70b-instruct-fp4": { host: "vllm-llama-3.3-70b-instruct-fp4", port: 8000, maxModelLen: 131072 },
  "eurollm-22b-instruct-fp4": { host: "vllm-eurollm-22b-fp4", port: 8000, maxModelLen: 32768 },
  "qwen2.5-1.5b-instruct": { host: "vllm-qwen2.5-1.5b", port: 8000, maxModelLen: 8192 },
  "phi-4-multimodal-instruct-fp4": { host: "vllm-phi-4-multimodal-fp4", port: 8000, maxModelLen: 32768 },
  "nemotron-3-nano-30b-fp8": { host: "vllm-nemotron-3-nano-30b-fp8", port: 8000, maxModelLen: 131072 },
  "phi-4-reasoning-plus-fp4": { host: "vllm-phi-4-reasoning-plus-fp4", port: 8000, maxModelLen: 32768 },
  "qwen2.5-vl-7b": { host: "vllm-qwen25-vl-7b", port: 8000, maxModelLen: 32768 },

  "glm-4-9b-chat": { host: "vllm-glm4-9b", port: 8000, maxModelLen: 32768 },
  "qwen3-coder-30b-a3b-instruct": { host: "vllm-qwen3-coder-30b", port: 8000, maxModelLen: 65536 },
  "qwen2.5-coder-7b-instruct": { host: "vllm-qwen25-coder-7b", port: 8000, maxModelLen: 32768 },
  "gemma-3-4b-it-qat": { host: "vllm-gemma3-4b", port: 8000, maxModelLen: 32768 },
  "gemma-2-27b-it": { host: "vllm-gemma2-27b", port: 8000, maxModelLen: 32768 },
  "gemma-2-9b-it": { host: "vllm-gemma2-9b", port: 8000, maxModelLen: 32768 },
  "qwen-math": { host: "vllm-qwen-math", port: 8000, maxModelLen: 4096 },
  "nemotron-nano-12b-v2-vl": { host: "vllm-nemotron", port: 8000, maxModelLen: 131072 },

  "mistral-nemo-instruct-2407": { host: "vllm-mistral-nemo-12b", port: 8000, maxModelLen: 128000 },
  "qwen3-vl-30b-instruct": { host: "vllm-qwen3-vl-30b", port: 8000, maxModelLen: 65536 },
  "qwen3-vl-30b-thinking-instruct": { host: "vllm-qwen3-vl-30b-thinking", port: 8000, maxModelLen: 65536 },
};

function log(...args) {
  if (VERBOSE) console.log("[validator]", ...args);
}

function warn(...args) {
  console.warn("[validator]", ...args);
}

function json(res, code, obj, headers = {}) {
  res.writeHead(code, { ...headers, "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

// Rough estimate of tokens from text
// Using ~2.5 chars per token (conservative for code/technical text which tokenizes more densely)
function estimateTokens(text) {
  if (typeof text !== "string") return 0;
  return Math.ceil(text.length / 2.5);
}

// Estimate total input tokens from messages
function estimateInputTokens(data) {
  let total = 0;
  // Base overhead for chat template, special tokens, etc.
  // Chat templates can add 500-2000 tokens depending on system prompts
  const overhead = 500;

  if (data.messages && Array.isArray(data.messages)) {
    for (const msg of data.messages) {
      if (msg.content) {
        if (typeof msg.content === "string") {
          total += estimateTokens(msg.content);
        } else if (Array.isArray(msg.content)) { // Multimodal content
          for (const part of msg.content) {
            if (part.type === "text" && part.text) {
              total += estimateTokens(part.text);
            } else if (part.type === "image_url") {
              total += 1500; // Conservative estimate for image tokens
            }
          }
        }
      }
      total += 20; // Overhead per message (role token, separators, etc.)
    }
  }
  return total + overhead;
}

// Validates and modifies the request body
function processBody(body, targetConfig, url) {
  try {
    const data = JSON.parse(body);

    // Normalize multimodal content format to string for models with chat templates that don't support it
    // OpenCode sends: {"content": [{"type": "text", "text": "Hi"}]}
    // Some chat templates (like Qwen3-Next) expect: {"content": "Hi"}
    // Skip VL/multimodal models and models that work without (like gpt-oss)
    const needsContentNormalization = data.model && (
      data.model.includes("qwen3-next") && !data.model.includes("-vl")
    );
    if (needsContentNormalization && Array.isArray(data.messages)) {
      for (const msg of data.messages) {
        if (Array.isArray(msg.content)) {
          // Extract text parts and concatenate, skip images for text-only models
          const textParts = msg.content
            .filter(part => part.type === "text" && part.text)
            .map(part => part.text);
          if (textParts.length > 0) {
            msg.content = textParts.join("\n");
            log(`Normalized multimodal content to string for ${data.model}`);
          }
        }
      }
    }

    // Fix for Gemma/Llama models that require strict role alternation (user/assistant/user...).
    // This logic handles merging consecutive roles and system prompt injection.
    if (data.model && (data.model.includes("gemma") || data.model.includes("llama")) && Array.isArray(data.messages)) {
      let systemContent = "";

      // Extract and remove all system messages
      data.messages = data.messages.filter(m => {
        if (m.role === "system") {
          systemContent += (systemContent ? "\n\n" : "") + (m.content || "");
          return false;
        }
        return true;
      });

      // Inject Llama specific tool instruction to force raw JSON arguments and prevent over-eager calling
      if (data.model.includes("llama")) {
        const toolInstruction = `CRITICAL INSTRUCTIONS:
1. When calling tools, you must provide array and object arguments as raw JSON values (e.g. [1, 2] or {"key": "value"}), NOT as JSON strings. Do not quote these values.
2. If the user greets you (e.g. "Hi", "Hello"), reply with text. Do NOT call tools unless specifically needed for a task.`;
        systemContent += (systemContent ? "\n\n" : "") + toolInstruction;
        log(`Injected strict tool instruction for Llama calling fix: ${data.model}`);

        // Also rewrite tool definitions to explicitly warn against stringification
        if (data.tools && Array.isArray(data.tools)) {
          const warnText = " (Provide as raw JSON, NOT a string)";

          // Helper to recursively update schema descriptions
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
            // Update parameter descriptions
            if (tool.function && tool.function.parameters) {
              updateSchema(tool.function.parameters);
            }
            // Specific fix for 'question' tool to prevent over-eager usage
            if (tool.function && tool.function.name === 'question') {
              tool.function.description += " Only use this tool if you need to gather specific information for a task. Do not use for general greetings.";
            }
          }
          log(`Rewrote tool descriptions for Llama model: ${data.model}`);
        }
      }

      // Merge consecutive messages with the same role
      const mergedMessages = [];
      for (const msg of data.messages) {
        if (mergedMessages.length > 0 && mergedMessages[mergedMessages.length - 1].role === msg.role) {
          // Merge content with the previous message of the same role
          const prev = mergedMessages[mergedMessages.length - 1];
          if (typeof prev.content === "string" && typeof msg.content === "string") {
            prev.content += "\n\n" + msg.content;
          } else {
            // Handle cases where content might be an array or other format
            prev.content = String(prev.content) + "\n\n" + String(msg.content);
          }
          log(`Merged consecutive ${msg.role} messages for Gemma`);
        } else {
          mergedMessages.push({ ...msg });
        }
      }
      data.messages = mergedMessages;

      // Prepend system content to the first user message
      if (systemContent) {
        log(`Found system prompt for ${data.model}, merging into user message.`);
        const prefix = `[System Instruction]\n${systemContent}\n\n`;

        if (data.messages.length > 0 && data.messages[0].role === "user") {
          if (typeof data.messages[0].content === "string") {
            data.messages[0].content = prefix + data.messages[0].content;
          } else if (Array.isArray(data.messages[0].content)) {
            data.messages[0].content.unshift({ type: "text", text: prefix });
          }
        } else {
          // Insert a new user message at the beginning with system content
          data.messages.unshift({ role: "user", content: prefix.trim() });
        }
      }

      // Ensure conversation starts with a user message
      if (data.messages.length === 0) {
        log(`Empty messages array for ${data.model}, adding placeholder user message`);
        data.messages.push({ role: "user", content: "Hi" });
      } else if (data.messages[0].role !== "user") {
        log(`First message is not user for ${data.model}, inserting placeholder`);
        data.messages.unshift({ role: "user", content: " " });
      }

      // Fix alternation: if two consecutive messages have the same role, insert a placeholder
      const fixedMessages = [];
      for (let i = 0; i < data.messages.length; i++) {
        const msg = data.messages[i];
        if (fixedMessages.length > 0) {
          const lastRole = fixedMessages[fixedMessages.length - 1].role;
          if (lastRole === msg.role) {
            // Insert a placeholder message to fix alternation
            const placeholderRole = lastRole === "user" ? "assistant" : "user";
            const placeholderContent = placeholderRole === "assistant" ? "Understood." : "Continue.";
            log(`Inserting ${placeholderRole} placeholder to fix alternation for ${data.model}`);
            fixedMessages.push({ role: placeholderRole, content: placeholderContent });
          }
        }
        fixedMessages.push(msg);
      }
      data.messages = fixedMessages;
    }

    const maxModelLen = targetConfig?.maxModelLen || 131072; // Default fallback
    const estimatedInput = estimateInputTokens(data);
    const safetyBuffer = Math.max(512, Math.floor(maxModelLen * 0.1));
    const availableTokens = maxModelLen - estimatedInput - safetyBuffer;
    const optimalMaxTokens = Math.max(1, availableTokens);

    // Normalize token limits: prefer max_completion_tokens (OpenAI's newer field), fallback to max_tokens
    // Different clients/models use different fields (OpenCode uses max_completion_tokens, vLLM uses max_tokens)
    // See: https://github.com/anomalyco/opencode/issues/9611
    let requestedMaxTokens = data.max_completion_tokens ?? data.max_tokens;

    if (requestedMaxTokens !== undefined) {
      log(`Requested tokens: ${requestedMaxTokens} (from ${data.max_completion_tokens !== undefined ? 'max_completion_tokens' : 'max_tokens'})`);
    }

    // Cap to safe limit or set default
    if (requestedMaxTokens === undefined || requestedMaxTokens < 1) {
      requestedMaxTokens = optimalMaxTokens;
      log(`Set max_tokens: ${optimalMaxTokens} (model: ${maxModelLen}, input: ~${estimatedInput})`);
    } else if (requestedMaxTokens > optimalMaxTokens) {
      log(`Capped max_tokens: ${requestedMaxTokens} -> ${optimalMaxTokens} (model: ${maxModelLen})`);
      requestedMaxTokens = optimalMaxTokens;
    }

    // Set both fields to the capped value for maximum compatibility
    data.max_tokens = requestedMaxTokens;
    data.max_completion_tokens = requestedMaxTokens;

    // Strip tool parameters for models that don't support tool calling
    // - Small utility models (270m, 1.5b, qwen-math)
    // - Vision/VL models (they don't have tool parsers configured)
    const noToolSupport = data.model && (
      data.model.includes("270m") ||
      data.model.includes("1.5b") ||
      data.model.includes("qwen-math") ||
      data.model.includes("-vl-") ||
      data.model.includes("-vl")
    );
    if (noToolSupport) {
      const toolParams = ["tool_choice", "tools", "functions", "function_call", "parallel_tool_calls"];
      for (const param of toolParams) {
        if (data[param] !== undefined) {
          log(`Stripping ${param} from small model ${data.model}`);
          delete data[param];
        }
      }
    }

    // Force tool_choice to "required" for models that ignore tools with "auto"
    // 
    // KNOWN ISSUES:
    // - qwen3-next FP4 models: tool_choice="required" crashes xgrammar structured outputs on GB10
    //   The xgrammar grammar constraints trigger CUDA illegal instruction on CUDA 12.1
    //   TODO: Re-enable for qwen3-next when vLLM/PyTorch supports CUDA 12.1/GB10 properly
    //
    // WORKING MODELS:
    // - qwen3-coder: Works with tool_choice="required"
    // - qwen2.5-coder: Works with tool_choice="required"
    const needsToolForcing = data.model && (
      data.model.includes("qwen3-coder") ||
      data.model.includes("qwen2.5-coder")
      // data.model.includes("qwen3-next")  // DISABLED: xgrammar crashes on GB10
    );
    const hasToolResults = Array.isArray(data.messages) && data.messages.some(m => m.role === "tool");
    if (needsToolForcing && data.tools && data.tools.length > 0 && !hasToolResults) {
      if (!data.tool_choice || data.tool_choice === "auto") {
        data.tool_choice = "required";
        log(`Forced tool_choice to required for ${data.model}`);
      }
    }

    return JSON.stringify(data);
  } catch (e) {
    warn("Failed to parse or process JSON body:", e.message);
    return body; // Return original body on failure
  }
}

// Proxy request to the final vLLM container
function proxyRequest(req, res, body, target) {
  log(`Proxying to ${target.host}:${target.port}${req.url}`);
  const options = {
    hostname: target.host,
    port: target.port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, "content-length": Buffer.byteLength(body) },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on("error", (err) => {
    warn(`Proxy error to ${target.host}:`, err.message);
    json(res, 502, { error: "Bad Gateway", message: err.message });
  });
  proxyReq.write(body);
  proxyReq.end();
}

// Main server logic
const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz" && req.method === "GET") {
    return json(res, 200, { status: "ok" });
  }

  // Read the entire request body first
  const body = await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });

  try {
    // Determine the target model from the request body
    let modelId;
    if (req.method === "POST" && body) {
      try {
        modelId = JSON.parse(body).model;
      } catch {
        return json(res, 400, { error: "Invalid JSON body" });
      }
    }

    if (!modelId) {
      return json(res, 400, { error: "Missing 'model' field in request body" });
    }

    const targetConfig = MODEL_CONFIG[modelId];
    if (!targetConfig) {
      return json(res, 404, { error: `Model '${modelId}' not found or not configured` });
    }

    // Call the waker's blocking ensure endpoint with a long timeout (21 min)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1260000);

    let wakerRes;
    try {
      wakerRes = await fetch(`${WAKER_URL}/ensure/${modelId}`, {
        method: "POST",
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeout);
      warn(`Waker fetch error for ${modelId}:`, err.message);
      return json(res, 504, { error: "Gateway Timeout", message: "Waker service took too long to respond or is unreachable" });
    } finally {
      clearTimeout(timeout);
    }

    let wakerBody;
    try {
      wakerBody = await wakerRes.json();
    } catch (err) {
      warn(`Failed to parse waker response for ${modelId}:`, err.message);
      return json(res, 502, { error: "Bad Gateway", message: "Invalid response from waker service" });
    }

    // If the model isn't ready (e.g., busy or error), forward the waker's response.
    if (wakerRes.status !== 200 || !wakerBody.ok) {
      // Filter headers: only forward relevant ones, exclude hop-by-hop or conflicting headers
      const forwardedHeaders = {};
      for (const [key, value] of wakerRes.headers.entries()) {
        const k = key.toLowerCase();
        if (k === "retry-after" || k.startsWith("x-")) {
          forwardedHeaders[key] = value;
        }
      }

      log(`Model not ready, forwarding waker's response (Status: ${wakerRes.status})`);
      return json(res, wakerRes.status, wakerBody, forwardedHeaders);
    }

    // Waker confirmed the model is ready, proceed to process the body and proxy.
    log(`Model ${modelId} is ready, processing and proxying request.`);
    const processedBody = processBody(body, targetConfig, req.url);
    proxyRequest(req, res, processedBody, targetConfig);

  } catch (err) {
    warn("Main handler error:", err);
    json(res, 500, { error: "Internal Server Error", message: err.message });
  }
});

server.setTimeout(0);
server.listen(PORT, () => {
  log(`Request validator listening on port ${PORT}`);
  log(`Configured models: ${Object.keys(MODEL_CONFIG).length}`);
});
