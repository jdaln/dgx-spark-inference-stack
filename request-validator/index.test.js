import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.MODELS_CONFIG_PATH = path.resolve(__dirname, "../models.json");
process.env.VERBOSE = "0";

const { processBody } = await import("./index.js");

const qwenTargetConfig = {
  modelId: "qwen3.6-27b-fp8",
  maxModelLen: 262144,
  toolSupport: "full",
  validatorProfile: "default",
  multimodal: false,
  normalizeTextContent: false
};

const gemmaTargetConfig = {
  modelId: "gemma4-26b-a4b",
  maxModelLen: 262144,
  toolSupport: "full",
  validatorProfile: "default",
  multimodal: true,
  normalizeTextContent: false
};

function runProcess(payload, targetConfig = qwenTargetConfig) {
  return JSON.parse(processBody(JSON.stringify(payload), targetConfig, "/v1/chat/completions"));
}

test("plain Qwen chat defaults to non-thinking mode", () => {
  const result = runProcess({
    model: "qwen3.6-27b-fp8",
    messages: [{ role: "user", content: "Reply with exactly READY" }],
    max_tokens: 64
  });

  assert.equal(result.thinking, false);
  assert.equal(result.chat_template_kwargs.enable_thinking, false);
  assert.equal(result.chat_template_kwargs.thinking, false);
  assert.equal(result.max_tokens, 64);
  assert.equal(result.max_completion_tokens, 64);
  assert.deepEqual(result.messages, [{ role: "user", content: "Reply with exactly READY" }]);
});

test("Qwen tool calls are preserved under default non-thinking mode", () => {
  const tools = [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get current weather for a location",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string" }
          },
          required: ["city"]
        }
      }
    }
  ];

  const result = runProcess({
    model: "qwen3.6-27b-fp8",
    messages: [{ role: "user", content: "Use the provided tool for Zurich." }],
    tools,
    tool_choice: "auto",
    max_tokens: 128
  });

  assert.equal(result.thinking, false);
  assert.equal(result.tool_choice, "auto");
  assert.deepEqual(result.tools, tools);
});

test("Qwen snake_case reasoning_effort none disables thinking", () => {
  const result = runProcess({
    model: "qwen3.6-27b-fp8",
    messages: [{ role: "user", content: "Reply with exactly NONE" }],
    reasoning_effort: "none",
    max_tokens: 64
  });

  assert.equal(result.reasoning_effort, undefined);
  assert.equal(result.thinking, false);
  assert.equal(result.chat_template_kwargs.enable_thinking, false);
  assert.equal(result.chat_template_kwargs.thinking, false);
});

test("Qwen camelCase reasoningEffort high enables thinking", () => {
  const result = runProcess({
    model: "qwen3.6-27b-fp8",
    messages: [{ role: "user", content: "Think, then reply with exactly HIGH" }],
    reasoningEffort: "high",
    max_tokens: 256
  });

  assert.equal(result.reasoningEffort, undefined);
  assert.equal(result.thinking, true);
  assert.equal(result.chat_template_kwargs.enable_thinking, true);
  assert.equal(result.chat_template_kwargs.thinking, true);
});

test("non-Qwen reasoning effort fields are preserved", () => {
  const result = runProcess(
    {
      model: "gemma4-26b-a4b",
      messages: [{ role: "user", content: "Reply with exactly GEMMA" }],
      reasoning: { effort: "high" },
      max_tokens: 64
    },
    gemmaTargetConfig
  );

  assert.deepEqual(result.reasoning, { effort: "high" });
  assert.equal(result.thinking, undefined);
});

test("high-context Qwen requests are capped with the smaller Qwen buffer", () => {
  const content = "x".repeat(800000);
  const result = runProcess({
    model: "qwen3.6-27b-fp8",
    messages: [{ role: "user", content }],
    max_tokens: 999999
  });

  const estimatedInput = Math.ceil(content.length / 4) + 520;
  const expectedMaxTokens = 262144 - estimatedInput - 4096;

  assert.equal(result.max_tokens, expectedMaxTokens);
  assert.equal(result.max_completion_tokens, expectedMaxTokens);
});