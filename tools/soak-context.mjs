#!/usr/bin/env node
// Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(SCRIPT_DIR, "..");
const WORKSPACE_TMP_DIR = join(REPO_DIR, "tmp");
const DEFAULT_BUNDLED_FILLER_RELATIVE_PATH = "tools/testdata/soak/stack-context-bundle.txt";
const DEFAULT_BUNDLED_FILLER_PATH = join(REPO_DIR, DEFAULT_BUNDLED_FILLER_RELATIVE_PATH);
const DEFAULT_SEMANTIC_PROFILE = "default-stack-summary";
const DEFAULT_REQUIRED_HEADINGS = ["Summary", "Risks", "Next Changes"];
const DEFAULT_STACK_TERMS = ["validator", "waker", "gateway", "vllm", "container"];

const DEFAULTS = {
  model: "qwen3.8-27b-nvfp4-dflash2",
  targetPromptTokens: null,
  concurrency: 5,
  requests: null,
  maxTokens: 1024,
  calibrationMaxTokens: 1,
  minCompletionTokens: 256,
  minContentChars: 1,
  requestTimeoutSeconds: 1800,
  url: process.env.GATEWAY_URL || "http://127.0.0.1:8009/v1/chat/completions",
  apiKey: process.env.VLLM_API_KEY || "63TestTOKEN0REPLACEME",
  calibrationRepeats: 1,
  tolerance: 256,
  maxCalibrationIterations: 4,
  filler: "alpha ",
  fillerFile: null,
  promptPrefix: "You are helping an engineer evaluate a production inference stack. Read the code and configuration context below, then answer directly for a human reader.\n\n",
  promptPrefixFile: null,
  promptSuffix: "\n\nQuestion: Based on the context above, what is this system doing, what are the two biggest reliability risks, and what are the two next changes you would make first? Return a final answer only in visible assistant content. Start immediately with markdown headings `Summary`, `Risks`, and `Next Changes`. Do not include chain-of-thought, planning notes, or hidden analysis.",
  promptSuffixFile: null,
  temperature: 0,
  disableThinking: false,
  enableThinking: false,
  semanticProfile: null,
};

function usage() {
  console.error(
    "usage: soak-context.mjs --target-prompt-tokens N [--model ID] [--concurrency N] [--requests N] [--max-tokens N|auto] [--min-completion-tokens N] [--min-content-chars N] [--disable-thinking] [--enable-thinking] [--semantic-profile NAME] [--calibration-max-tokens N] [--request-timeout-seconds N] [--filler TEXT|--filler-file PATH] [--prompt-prefix TEXT|--prompt-prefix-file PATH] [--prompt-suffix TEXT|--prompt-suffix-file PATH] [--url URL] [--api-key KEY]"
  );
  console.error(`default repeatable filler file: ${DEFAULT_BUNDLED_FILLER_RELATIVE_PATH}`);
  console.error(`default semantic profile for built-in prompt: ${DEFAULT_SEMANTIC_PROFILE}`);
  process.exit(1);
}

function parseArgs(argv) {
  const config = { ...DEFAULTS };
  let fillerProvided = false;
  let fillerFileProvided = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--model":
        config.model = argv[++index];
        break;
      case "--target-prompt-tokens":
        config.targetPromptTokens = Number(argv[++index]);
        break;
      case "--concurrency":
        config.concurrency = Number(argv[++index]);
        break;
      case "--requests":
        config.requests = Number(argv[++index]);
        break;
      case "--max-tokens": {
        // "auto" omits max_tokens, so the engine sets the budget to the remaining context.
        // Thinking lanes need it: a fixed cap is spent on reasoning and looks like a context failure.
        const rawMaxTokens = argv[++index];
        config.maxTokens = rawMaxTokens === "auto" ? null : Number(rawMaxTokens);
        break;
      }
      case "--calibration-max-tokens":
        config.calibrationMaxTokens = Number(argv[++index]);
        break;
      case "--min-completion-tokens":
        config.minCompletionTokens = Number(argv[++index]);
        break;
      case "--min-content-chars":
        config.minContentChars = Number(argv[++index]);
        break;
      case "--disable-thinking":
        config.disableThinking = true;
        break;
      case "--enable-thinking":
        config.enableThinking = true;
        break;
      case "--semantic-profile":
        config.semanticProfile = argv[++index];
        break;
      case "--request-timeout-seconds":
        config.requestTimeoutSeconds = Number(argv[++index]);
        break;
      case "--url":
        config.url = argv[++index];
        break;
      case "--api-key":
        config.apiKey = argv[++index];
        break;
      case "--calibration-repeats":
        config.calibrationRepeats = Number(argv[++index]);
        break;
      case "--tolerance":
        config.tolerance = Number(argv[++index]);
        break;
      case "--max-calibration-iterations":
        config.maxCalibrationIterations = Number(argv[++index]);
        break;
      case "--filler":
        config.filler = argv[++index];
        fillerProvided = true;
        break;
      case "--filler-file":
        config.fillerFile = argv[++index];
        fillerFileProvided = true;
        break;
      case "--prompt-prefix":
        config.promptPrefix = argv[++index];
        break;
      case "--prompt-prefix-file":
        config.promptPrefixFile = argv[++index];
        break;
      case "--prompt-suffix":
        config.promptSuffix = argv[++index];
        break;
      case "--prompt-suffix-file":
        config.promptSuffixFile = argv[++index];
        break;
      case "--help":
      case "-h":
        usage();
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        usage();
    }
  }

  if (!Number.isFinite(config.targetPromptTokens) || config.targetPromptTokens <= 0) {
    console.error("--target-prompt-tokens must be a positive number");
    usage();
  }

  if (!Number.isFinite(config.concurrency) || config.concurrency <= 0) {
    console.error("--concurrency must be a positive number");
    usage();
  }

  if (config.requests == null) {
    config.requests = config.concurrency;
  }

  if (!Number.isFinite(config.requests) || config.requests <= 0) {
    console.error("--requests must be a positive number");
    usage();
  }

  if (config.maxTokens !== null && (!Number.isFinite(config.maxTokens) || config.maxTokens <= 0)) {
    console.error("--max-tokens must be a positive number or \"auto\"");
    usage();
  }

  if (!Number.isFinite(config.calibrationMaxTokens) || config.calibrationMaxTokens <= 0) {
    console.error("--calibration-max-tokens must be a positive number");
    usage();
  }

  if (!Number.isFinite(config.requestTimeoutSeconds) || config.requestTimeoutSeconds <= 0) {
    console.error("--request-timeout-seconds must be a positive number");
    usage();
  }

  if (!Number.isFinite(config.minCompletionTokens) || config.minCompletionTokens < 0) {
    console.error("--min-completion-tokens must be zero or a positive number");
    usage();
  }

  if (!Number.isFinite(config.minContentChars) || config.minContentChars < 0) {
    console.error("--min-content-chars must be zero or a positive number");
    usage();
  }

  let fillerFilePath = config.fillerFile;
  if (!fillerProvided && !fillerFileProvided && existsSync(DEFAULT_BUNDLED_FILLER_PATH)) {
    fillerFilePath = DEFAULT_BUNDLED_FILLER_PATH;
    config.fillerFile = DEFAULT_BUNDLED_FILLER_RELATIVE_PATH;
  }

  if (fillerFilePath) {
    config.filler = readFileSync(fillerFilePath, "utf8");
  }

  if (config.promptPrefixFile) {
    config.promptPrefix = readFileSync(config.promptPrefixFile, "utf8");
  }

  if (config.promptSuffixFile) {
    config.promptSuffix = readFileSync(config.promptSuffixFile, "utf8");
  }

  if (config.semanticProfile == null) {
    const usingDefaultPrompt =
      !config.promptPrefixFile &&
      !config.promptSuffixFile &&
      config.promptPrefix === DEFAULTS.promptPrefix &&
      config.promptSuffix === DEFAULTS.promptSuffix;
    config.semanticProfile = usingDefaultPrompt ? DEFAULT_SEMANTIC_PROFILE : "none";
  }

  if (!config.filler || config.filler.length === 0) {
    console.error("filler content must not be empty");
    usage();
  }

  return config;
}

// Cut to `length` UTF-16 code units without splitting a surrogate pair.
function sliceWholeCodePoints(text, length) {
  if (length >= text.length) {
    return text;
  }
  let end = Math.max(0, length);
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) {
    end -= 1; // would leave a high surrogate dangling
  }
  return text.slice(0, end);
}

// `repeats` may be fractional: whole copies of the filler, then a prefix of one more copy.
// One copy is ~22.5k tokens, so whole copies alone cannot reach the top of a window.
function buildPrompt(config, repeats) {
  const whole = Math.max(0, Math.floor(repeats));
  const fraction = repeats - whole;
  const body = config.filler.repeat(whole);
  const tail = fraction > 0
    ? sliceWholeCodePoints(config.filler, Math.floor(fraction * config.filler.length))
    : "";
  return `${config.promptPrefix}${body}${tail}${config.promptSuffix}`;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasHeading(content, heading) {
  const escaped = escapeRegExp(heading.toLowerCase());
  const pattern = new RegExp(`(^|\\n)\\s{0,3}(?:#{1,6}\\s*|\\*{1,2})?${escaped}(?:\\*{1,2})?\\b`, "i");
  return pattern.test(content);
}

function evaluateSemanticProfile(config, contentText) {
  if (config.semanticProfile === "none") {
    return {
      profile: "none",
      matchedHeadings: [],
      missingHeadings: [],
      matchedTerms: [],
      requiredTermCount: 0,
      meetsSemanticFloor: true,
    };
  }

  const loweredContent = (contentText || "").toLowerCase();
  const matchedHeadings = DEFAULT_REQUIRED_HEADINGS.filter((heading) => hasHeading(loweredContent, heading));
  const missingHeadings = DEFAULT_REQUIRED_HEADINGS.filter((heading) => !matchedHeadings.includes(heading));

  // Require only stack terms that appear in the filler; a --filler-file corpus may have none.
  const loweredFiller = (config.filler || "").toLowerCase();
  const applicableTerms = DEFAULT_STACK_TERMS.filter((term) => loweredFiller.includes(term));
  const matchedTerms = applicableTerms.filter((term) => loweredContent.includes(term));
  const requiredTermCount = Math.min(2, applicableTerms.length);
  const meetsSemanticFloor =
    missingHeadings.length === 0 && matchedTerms.length >= requiredTermCount;

  return {
    profile: config.semanticProfile,
    matchedHeadings,
    missingHeadings,
    matchedTerms,
    // 0 applicable terms: only the heading structure was enforced.
    applicableTerms,
    requiredTermCount,
    meetsSemanticFloor,
  };
}

async function sendRequest(config, promptText, maxTokens = config.maxTokens) {
  const payload = {
    model: config.model,
    messages: [{ role: "user", content: promptText }],
    temperature: config.temperature,
    stream: false,
  };

  if (maxTokens !== null) {
    payload.max_tokens = maxTokens;
  }

  if (config.disableThinking) {
    payload.chat_template_kwargs = {
      enable_thinking: false,
      thinking: false,
    };
  } else if (config.enableThinking) {
    // Some lanes answer complex long-context tasks reliably only with thinking on.
    payload.chat_template_kwargs = {
      enable_thinking: true,
      thinking: true,
    };
  }

  const startedAt = Date.now();
  const marker = "__SOAK_STATUS__:";
  mkdirSync(WORKSPACE_TMP_DIR, { recursive: true });
  const tempDir = mkdtempSync(join(WORKSPACE_TMP_DIR, "soak-context."));
  const payloadPath = join(tempDir, "payload.json");
  writeFileSync(payloadPath, JSON.stringify(payload));
  const args = [
    "-sS",
    "--max-time",
    String(config.requestTimeoutSeconds),
    "-H",
    `Authorization: Bearer ${config.apiKey}`,
    "-H",
    "Content-Type: application/json",
    "-X",
    "POST",
    config.url,
    "--data-binary",
    `@${payloadPath}`,
    "-w",
    `\\n${marker}%{http_code}`,
  ];

  let stdout = "";
  let stderr = "";
  try {
    try {
      const result = await execFileAsync("curl", args, { maxBuffer: 16 * 1024 * 1024 });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      stdout = error.stdout ?? "";
      stderr = error.stderr ?? error.message ?? "";
      if (!stdout.includes(marker)) {
        throw new Error(stderr || error.message);
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const elapsedMs = Date.now() - startedAt;
  const markerIndex = stdout.lastIndexOf(marker);
  if (markerIndex === -1) {
    throw new Error(stderr || "curl response did not include a status marker");
  }

  const text = stdout.slice(0, markerIndex).trimEnd();
  const statusText = stdout.slice(markerIndex + marker.length).trim();
  const status = Number(statusText);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }

  return {
    status,
    ok: status >= 200 && status < 300,
    elapsedMs,
    body: json,
    promptTokens: json?.usage?.prompt_tokens ?? null,
    completionTokens: json?.usage?.completion_tokens ?? null,
  };
}

// Whether a 400 says the prompt is too long. Only that bounds the calibration search.
function isContextOverflow(result) {
  if (result.status !== 400) {
    return false;
  }
  const message = String(
    result.body?.error?.message ?? result.body?.error ?? result.body?.message ?? ""
  ).toLowerCase();
  return (
    message.includes("context length") ||
    message.includes("context_length") ||
    message.includes("input tokens") ||
    message.includes("longer than the maximum") ||
    message.includes("maximum context")
  );
}

async function calibratePrompt(config) {
  const attempts = [];
  let repeats = config.calibrationRepeats;

  // Bracket search between the largest accepted and the smallest rejected repeat count.
  let okRepeats = 0;
  let okResult = null;
  let overflowRepeats = Infinity;

  const finish = (failed) => ({
    attempts,
    finalRepeats: okResult ? okRepeats : repeats,
    finalPromptTokens: okResult ? okResult.promptTokens : null,
    failed,
    // True when the context ceiling, not the target, decided the final size.
    cappedByContext: Number.isFinite(overflowRepeats) && Boolean(okResult),
  });

  for (let iteration = 1; iteration <= config.maxCalibrationIterations; iteration += 1) {
    const result = await sendRequest(
      config,
      buildPrompt(config, repeats),
      config.calibrationMaxTokens
    );
    attempts.push({ iteration, repeats, ...result });

    if (!result.ok || !Number.isFinite(result.promptTokens)) {
      // Any other failure (a crashed container, a waker timeout) is infrastructure, not size.
      // Shrinking the prompt for it would soak a size nobody asked for, so abort.
      if (!isContextOverflow(result)) {
        return {
          attempts,
          finalRepeats: okResult ? okRepeats : repeats,
          finalPromptTokens: okResult ? okResult.promptTokens : null,
          failed: true,
          cappedByContext: false,
          infrastructureFailure:
            `calibration aborted: status ${result.status ?? "?"} is not a context-overflow ` +
            `rejection, so it says nothing about prompt size. Fix the lane and re-run rather ` +
            `than trusting a smaller calibrated prompt. Upstream said: ` +
            `${(result.body?.error?.message ?? result.body?.error ?? "no message").toString().slice(0, 300)}`,
        };
      }

      overflowRepeats = Math.min(overflowRepeats, repeats);

      // Step back into the bracket; fractional repeats allow small steps.
      const next = okRepeats > 0
        ? (okRepeats + overflowRepeats) / 2
        : repeats / 2;

      // Give up only once the bracket is narrower than the resolution we care about.
      const tokensPerRepeat = okResult ? okResult.promptTokens / okRepeats : null;
      const bracketTokens = tokensPerRepeat ? (overflowRepeats - okRepeats) * tokensPerRepeat : Infinity;
      if (next <= 0 || next <= okRepeats || bracketTokens <= config.tolerance) {
        // Nothing worth trying: report the best accepted attempt, or fail if there is none.
        return finish(!okResult);
      }

      repeats = next;
      continue;
    }

    okRepeats = repeats;
    okResult = result;

    const delta = Math.abs(result.promptTokens - config.targetPromptTokens);
    if (delta <= config.tolerance) {
      return finish(false);
    }

    const tokensPerRepeat = result.promptTokens / repeats;
    let scaledRepeats = repeats * (config.targetPromptTokens / result.promptTokens);

    // Aim midway into the bracket, never at or past a known overflow.
    if (Number.isFinite(overflowRepeats) && scaledRepeats >= overflowRepeats) {
      scaledRepeats = (repeats + overflowRepeats) / 2;
    }

    // Stop when a step would move the prompt by less than the tolerance.
    const stepTokens = Math.abs(scaledRepeats - repeats) * tokensPerRepeat;
    if (scaledRepeats <= 0 || stepTokens <= config.tolerance) {
      return finish(false);
    }

    repeats = scaledRepeats;
  }

  // Out of iterations: fall back to the largest accepted attempt.
  return finish(!okResult);
}

// vLLM 0.26+ returns `reasoning`; older vLLM and SGLang return `reasoning_content`.
function extractReasoningText(message) {
  if (!message || typeof message !== "object") {
    return "";
  }
  const reasoning = message.reasoning ?? message.reasoning_content;
  return typeof reasoning === "string" ? reasoning : "";
}

async function runConcurrentRequests(config, promptText) {
  const total = config.requests;
  const concurrency = Math.min(config.concurrency, total);
  const results = new Array(total);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= total) {
        return;
      }

      try {
        const result = await sendRequest(config, promptText);
        const message = result.body?.choices?.[0]?.message;
        const contentText = message?.content ?? "";
        const reasoningText = extractReasoningText(message);
        results[current] = {
          request: current + 1,
          status: result.status,
          ok: result.ok,
          elapsedMs: result.elapsedMs,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          hasChoices: Array.isArray(result.body?.choices) && result.body.choices.length > 0,
          finishReason: result.body?.choices?.[0]?.finish_reason ?? null,
          contentLength: contentText.length,
          reasoningLength: reasoningText.length,
          contentPreview: contentText.slice(0, 200) || null,
          reasoningPreview: reasoningText.slice(0, 200) || null,
          contentText,
          error: result.body?.error ?? null,
        };
      } catch (error) {
        results[current] = {
          request: current + 1,
          status: null,
          ok: false,
          elapsedMs: null,
          promptTokens: null,
          completionTokens: null,
          hasChoices: false,
          finishReason: null,
          contentLength: 0,
          reasoningLength: 0,
          contentPreview: null,
          reasoningPreview: null,
          error: { message: error.message },
        };
      }
    }
  }

  const startedAt = Date.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { totalElapsedMs: Date.now() - startedAt, results };
}

// Saved under tmp/soak/ so the result can be read after the run, also from a container.
function saveReport(config, summary) {
  const dir = join(WORKSPACE_TMP_DIR, "soak");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `${config.model}-${config.targetPromptTokens}-${stamp}.json`);
  writeFileSync(path, JSON.stringify(summary, null, 2) + "\n");
  console.error(`report: ${relative(REPO_DIR, path)}`);
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const calibration = await calibratePrompt(config);

  const summary = {
    config: {
      model: config.model,
      targetPromptTokens: config.targetPromptTokens,
      concurrency: config.concurrency,
      requests: config.requests,
      maxTokens: config.maxTokens,
      calibrationMaxTokens: config.calibrationMaxTokens,
      minCompletionTokens: config.minCompletionTokens,
      minContentChars: config.minContentChars,
      disableThinking: config.disableThinking,
      enableThinking: config.enableThinking,
      semanticProfile: config.semanticProfile,
      requestTimeoutSeconds: config.requestTimeoutSeconds,
      url: config.url,
      calibrationRepeats: config.calibrationRepeats,
      tolerance: config.tolerance,
      fillerFile: config.fillerFile,
      promptPrefixFile: config.promptPrefixFile,
      promptSuffixFile: config.promptSuffixFile,
    },
    calibration: {
      finalRepeats: calibration.finalRepeats,
      finalPromptTokens: calibration.finalPromptTokens,
      // The context ceiling, not the target, decided the prompt size. The soak is still valid.
      cappedByContext: calibration.cappedByContext ?? false,
      // Calibration hit a failure other than prompt size. No soak ran; the run is void.
      ...(calibration.infrastructureFailure
        ? { infrastructureFailure: calibration.infrastructureFailure }
        : {}),
      ...(calibration.cappedByContext
        ? {
            hint:
              `Requested ${config.targetPromptTokens} prompt tokens, but the model rejected ` +
              `larger fillers; soaked ${calibration.finalPromptTokens} instead. This is the ` +
              `measured ceiling for this filler, not a lane failure.`,
          }
        : {}),
      attempts: calibration.attempts.map((attempt) => ({
        iteration: attempt.iteration,
        repeats: attempt.repeats,
        status: attempt.status,
        ok: attempt.ok,
        elapsedMs: attempt.elapsedMs,
        promptTokens: attempt.promptTokens,
        error: attempt.body?.error ?? null,
      })),
    },
  };

  if (calibration.failed) {
    summary.soak = null;
    console.log(JSON.stringify(summary, null, 2));
    saveReport(config, summary);
    process.exit(1);
  }

  const promptText = buildPrompt(config, calibration.finalRepeats);
  summary.soak = await runConcurrentRequests(config, promptText);

  for (const result of summary.soak.results) {
    result.meetsCompletionFloor =
      result.completionTokens == null ? false : result.completionTokens >= config.minCompletionTokens;
    result.meetsContentFloor = result.contentLength >= config.minContentChars;
    const semanticEvaluation = evaluateSemanticProfile(config, result.contentText);
    result.semanticProfile = semanticEvaluation.profile;
    result.semanticMatchedHeadings = semanticEvaluation.matchedHeadings;
    result.semanticMissingHeadings = semanticEvaluation.missingHeadings;
    result.semanticMatchedTerms = semanticEvaluation.matchedTerms;
    result.semanticApplicableTerms = semanticEvaluation.applicableTerms;
    result.semanticRequiredTermCount = semanticEvaluation.requiredTermCount;
    result.meetsSemanticFloor = semanticEvaluation.meetsSemanticFloor;
    // All tokens went to reasoning, which looks like a context failure. Say so, so the
    // operator raises --max-tokens or passes --disable-thinking.
    result.budgetExhaustedByReasoning =
      result.contentLength === 0 && result.reasoningLength > 0 && result.finishReason === "length";
    delete result.contentText;
  }

  const failedRequests = summary.soak.results.filter(
    (result) =>
      !result.ok ||
      !result.meetsCompletionFloor ||
      !result.meetsContentFloor ||
      !result.meetsSemanticFloor
  );
  const budgetStarved = summary.soak.results.filter((result) => result.budgetExhaustedByReasoning);
  if (budgetStarved.length > 0) {
    summary.soak.hint =
      `${budgetStarved.length}/${summary.soak.results.length} requests spent the entire ` +
      `completion budget (--max-tokens ${config.maxTokens ?? "auto"}) on reasoning and returned ` +
      `no content. This is a completion-budget limit, not a context-length limit: re-run with ` +
      `--max-tokens auto (production shape) or --disable-thinking before recording a ceiling ` +
      `for this tier.`;
  }

  console.log(JSON.stringify(summary, null, 2));
  saveReport(config, summary);
  if (failedRequests.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});