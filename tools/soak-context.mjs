#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
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
  model: "glm-4.7-flash-awq",
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
  stream: false,
  disableThinking: false,
  semanticProfile: null,
};

function usage() {
  console.error(
    "usage: soak-context.mjs --target-prompt-tokens N [--model ID] [--concurrency N] [--requests N] [--max-tokens N] [--min-completion-tokens N] [--min-content-chars N] [--disable-thinking] [--semantic-profile NAME] [--calibration-max-tokens N] [--request-timeout-seconds N] [--filler TEXT|--filler-file PATH] [--prompt-prefix TEXT|--prompt-prefix-file PATH] [--prompt-suffix TEXT|--prompt-suffix-file PATH] [--url URL] [--api-key KEY]"
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
      case "--max-tokens":
        config.maxTokens = Number(argv[++index]);
        break;
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

  if (!Number.isFinite(config.maxTokens) || config.maxTokens <= 0) {
    console.error("--max-tokens must be a positive number");
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

function buildPrompt(config, repeats) {
  return `${config.promptPrefix}${config.filler.repeat(repeats)}${config.promptSuffix}`;
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
  const matchedTerms = DEFAULT_STACK_TERMS.filter((term) => loweredContent.includes(term));
  const requiredTermCount = 2;
  const meetsSemanticFloor =
    missingHeadings.length === 0 && matchedTerms.length >= requiredTermCount;

  return {
    profile: config.semanticProfile,
    matchedHeadings,
    missingHeadings,
    matchedTerms,
    requiredTermCount,
    meetsSemanticFloor,
  };
}

async function sendRequest(config, promptText, maxTokens = config.maxTokens) {
  const payload = {
    model: config.model,
    messages: [{ role: "user", content: promptText }],
    temperature: config.temperature,
    max_tokens: maxTokens,
    stream: config.stream,
  };

  if (config.disableThinking) {
    payload.chat_template_kwargs = {
      enable_thinking: false,
      thinking: false,
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

async function calibratePrompt(config) {
  const attempts = [];
  let repeats = config.calibrationRepeats;

  for (let iteration = 1; iteration <= config.maxCalibrationIterations; iteration += 1) {
    const result = await sendRequest(
      config,
      buildPrompt(config, repeats),
      config.calibrationMaxTokens
    );
    attempts.push({ iteration, repeats, ...result });

    if (!result.ok) {
      return { attempts, finalRepeats: repeats, finalPromptTokens: null, failed: true };
    }

    if (!Number.isFinite(result.promptTokens)) {
      return { attempts, finalRepeats: repeats, finalPromptTokens: null, failed: true };
    }

    const delta = Math.abs(result.promptTokens - config.targetPromptTokens);
    if (delta <= config.tolerance) {
      return {
        attempts,
        finalRepeats: repeats,
        finalPromptTokens: result.promptTokens,
        failed: false,
      };
    }

    const scaledRepeats = Math.max(
      1,
      Math.round(repeats * (config.targetPromptTokens / result.promptTokens))
    );

    if (scaledRepeats === repeats) {
      return {
        attempts,
        finalRepeats: repeats,
        finalPromptTokens: result.promptTokens,
        failed: false,
      };
    }

    repeats = scaledRepeats;
  }

  const lastAttempt = attempts[attempts.length - 1];
  return {
    attempts,
    finalRepeats: lastAttempt?.repeats ?? repeats,
    finalPromptTokens: lastAttempt?.promptTokens ?? null,
    failed: false,
  };
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
        const contentText = result.body?.choices?.[0]?.message?.content ?? "";
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
          reasoningLength: result.body?.choices?.[0]?.message?.reasoning?.length ?? 0,
          contentPreview: contentText.slice(0, 200) || null,
          reasoningPreview:
            result.body?.choices?.[0]?.message?.reasoning?.slice(0, 200) ?? null,
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
    result.semanticRequiredTermCount = semanticEvaluation.requiredTermCount;
    result.meetsSemanticFloor = semanticEvaluation.meetsSemanticFloor;
    delete result.contentText;
  }

  const failedRequests = summary.soak.results.filter(
    (result) =>
      !result.ok ||
      !result.meetsCompletionFloor ||
      !result.meetsContentFloor ||
      !result.meetsSemanticFloor
  );
  console.log(JSON.stringify(summary, null, 2));
  if (failedRequests.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});