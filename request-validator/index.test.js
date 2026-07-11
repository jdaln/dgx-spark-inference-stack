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

const qwenOpusTargetConfig = {
  modelId: "qwen3.6-35b-a3b-opus-distilled",
  maxModelLen: 262144,
  toolSupport: "full",
  validatorProfile: "default",
  multimodal: false,
  normalizeTextContent: false
};

const huihuiQwenOpusAbliteratedTargetConfig = {
  modelId: "huihui-qwen3.6-35b-a3b-claude-4.7-opus-abliterated",
  maxModelLen: 262144,
  toolSupport: "full",
  validatorProfile: "default",
  multimodal: false,
  normalizeTextContent: false
};

const jackrongQwenOpusReasoningTargetConfig = {
  modelId: "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled",
  maxModelLen: 262144,
  toolSupport: "full",
  validatorProfile: "default",
  multimodal: false,
  normalizeTextContent: true
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

  assert.equal(result.thinking, undefined);
  assert.equal(result.chat_template_kwargs.enable_thinking, false);
  assert.equal(result.chat_template_kwargs.thinking, false);
  assert.equal(result.max_tokens, 64);
  assert.equal(result.max_completion_tokens, 64);
  assert.deepEqual(result.messages, [{ role: "user", content: "Reply with exactly READY" }]);
});

test("Opus-distilled Qwen chat defaults to non-thinking mode", () => {
  const result = runProcess(
    {
      model: "qwen3.6-35b-a3b-opus-distilled",
      messages: [{ role: "user", content: "Reply with exactly READY" }],
      max_tokens: 64
    },
    qwenOpusTargetConfig
  );

  assert.equal(result.thinking, undefined);
  assert.equal(result.chat_template_kwargs.enable_thinking, false);
  assert.equal(result.chat_template_kwargs.thinking, false);
  assert.equal(result.max_tokens, 64);
  assert.equal(result.max_completion_tokens, 64);
});

test("Huihui Opus-abliterated Qwen chat defaults to non-thinking mode", () => {
  const result = runProcess(
    {
      model: "huihui-qwen3.6-35b-a3b-claude-4.7-opus-abliterated",
      messages: [{ role: "user", content: "Reply with exactly READY" }],
      max_tokens: 64
    },
    huihuiQwenOpusAbliteratedTargetConfig
  );

  assert.equal(result.thinking, undefined);
  assert.equal(result.chat_template_kwargs.enable_thinking, false);
  assert.equal(result.chat_template_kwargs.thinking, false);
  assert.equal(result.max_tokens, 64);
  assert.equal(result.max_completion_tokens, 64);
});

test("Jackrong Qwen reasoning-distilled chat defaults to non-thinking mode", () => {
  const result = runProcess(
    {
      model: "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled",
      messages: [{ role: "user", content: "Reply with exactly READY" }],
      max_tokens: 64
    },
    jackrongQwenOpusReasoningTargetConfig
  );

  assert.equal(result.chat_template_kwargs.enable_thinking, false);
  assert.equal(result.chat_template_kwargs.thinking, false);
  assert.equal(result.max_tokens, 64);
  assert.equal(result.max_completion_tokens, 64);
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

  assert.equal(result.thinking, undefined);
  assert.equal(result.chat_template_kwargs.enable_thinking, false);
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
  assert.equal(result.thinking, undefined);
  assert.equal(result.chat_template_kwargs.enable_thinking, false);
  assert.equal(result.chat_template_kwargs.thinking, false);
});

test("Jackrong Qwen tool calls are preserved under default non-thinking mode", () => {
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

  const result = runProcess(
    {
      model: "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled",
      messages: [{ role: "user", content: "Use the provided tool for Zurich." }],
      tools,
      tool_choice: "auto",
      max_tokens: 128
    },
    jackrongQwenOpusReasoningTargetConfig
  );

  assert.equal(result.chat_template_kwargs.enable_thinking, false);
  assert.equal(result.tool_choice, "auto");
  assert.deepEqual(result.tools, tools);
});

test("Qwen camelCase reasoningEffort high enables thinking", () => {
  const result = runProcess({
    model: "qwen3.6-27b-fp8",
    messages: [{ role: "user", content: "Think, then reply with exactly HIGH" }],
    reasoningEffort: "high",
    max_tokens: 256
  });

  assert.equal(result.reasoningEffort, undefined);
  assert.equal(result.thinking, undefined);
  assert.equal(result.chat_template_kwargs.enable_thinking, true);
  assert.equal(result.chat_template_kwargs.thinking, true);
  assert.deepEqual(result.messages, [{ role: "user", content: "Think, then reply with exactly HIGH" }]);
});

test("Opus-distilled Qwen camelCase reasoningEffort high enables thinking", () => {
  const result = runProcess(
    {
      model: "qwen3.6-35b-a3b-opus-distilled",
      messages: [{ role: "user", content: "Think, then reply with exactly HIGH" }],
      reasoningEffort: "high",
      max_tokens: 256
    },
    qwenOpusTargetConfig
  );

  assert.equal(result.reasoningEffort, undefined);
  assert.equal(result.thinking, undefined);
  assert.equal(result.chat_template_kwargs.enable_thinking, true);
  assert.equal(result.chat_template_kwargs.thinking, true);
});

test("Huihui Opus-abliterated Qwen camelCase reasoningEffort high enables thinking", () => {
  const result = runProcess(
    {
      model: "huihui-qwen3.6-35b-a3b-claude-4.7-opus-abliterated",
      messages: [{ role: "user", content: "Think, then reply with exactly HIGH" }],
      reasoningEffort: "high",
      max_tokens: 256
    },
    huihuiQwenOpusAbliteratedTargetConfig
  );

  assert.equal(result.reasoningEffort, undefined);
  assert.equal(result.thinking, undefined);
  assert.equal(result.chat_template_kwargs.enable_thinking, true);
  assert.equal(result.chat_template_kwargs.thinking, true);
});

test("Jackrong Qwen camelCase reasoningEffort high enables thinking", () => {
  const result = runProcess(
    {
      model: "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled",
      messages: [{ role: "user", content: "Think, then reply with exactly HIGH" }],
      reasoningEffort: "high",
      max_tokens: 256
    },
    jackrongQwenOpusReasoningTargetConfig
  );

  assert.equal(result.reasoningEffort, undefined);
  assert.equal(result.thinking, undefined);
  assert.equal(result.chat_template_kwargs.enable_thinking, true);
  assert.equal(result.chat_template_kwargs.thinking, true);
});

test("explicit top-level Qwen thinking is normalized into chat_template_kwargs", () => {
  const result = runProcess({
    model: "qwen3.6-27b-fp8",
    messages: [{ role: "user", content: "Reply with exactly READY" }],
    thinking: false,
    max_tokens: 64
  });

  assert.equal(result.thinking, undefined);
  assert.equal(result.chat_template_kwargs.enable_thinking, false);
  assert.equal(result.chat_template_kwargs.thinking, false);
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

test("Jackrong reasoning-distilled requests use the smaller Qwen buffer", () => {
  const content = "x".repeat(800000);
  const result = runProcess(
    {
      model: "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled",
      messages: [{ role: "user", content }],
      max_tokens: 999999
    },
    jackrongQwenOpusReasoningTargetConfig
  );

  const estimatedInput = Math.ceil(content.length / 4) + 520;
  const expectedMaxTokens = 262144 - estimatedInput - 4096;

  assert.equal(result.max_tokens, expectedMaxTokens);
  assert.equal(result.max_completion_tokens, expectedMaxTokens);
});

const llamaTargetConfig = {
  modelId: "llama-3.3-70b-instruct-fp4",
  maxModelLen: 131072,
  toolSupport: "full",
  validatorProfile: "default",
  multimodal: false,
  normalizeTextContent: false
};

test("gemma messages pass through unmodified (structure is owned by the chat template)", () => {
  const messages = [
    { role: "system", content: "You are terse." },
    { role: "system", content: "Answer in French." },
    { role: "user", content: [{ type: "text", text: "Describe this" }, { type: "image_url", image_url: { url: "data:x" } }] },
    { role: "assistant", content: "", tool_calls: [{ id: "a", function: { name: "f", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "a", content: "result-a" },
    { role: "tool", tool_call_id: "b", content: "result-b" },
    { role: "user", content: "and again" },
    { role: "user", content: "with a second user turn" }
  ];

  const result = runProcess(
    { model: "gemma4-26b-a4b", messages, max_tokens: 64 },
    gemmaTargetConfig
  );

  assert.deepEqual(result.messages, messages);
});

test("llama with tools gets a system instruction after existing system messages", () => {
  const result = runProcess(
    {
      model: "llama-3.3-70b-instruct-fp4",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "hi" }
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "list_files",
            description: "List files",
            parameters: {
              type: "object",
              properties: {
                paths: { type: "array", description: "Paths", items: { type: "string" } }
              }
            }
          }
        }
      ],
      max_tokens: 64
    },
    llamaTargetConfig
  );

  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].content, "You are helpful.");
  assert.equal(result.messages[1].role, "system");
  assert.match(result.messages[1].content, /raw JSON values/);
  assert.equal(result.messages[2].role, "user");
  const params = result.tools[0].function.parameters;
  assert.match(params.description, /raw JSON, NOT a string/);
  assert.match(params.properties.paths.description, /raw JSON, NOT a string/);
});

test("llama without tools passes messages through unmodified", () => {
  const messages = [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "hi" },
    { role: "user", content: "second consecutive user message" }
  ];

  const result = runProcess(
    { model: "llama-3.3-70b-instruct-fp4", messages, max_tokens: 64 },
    llamaTargetConfig
  );

  assert.deepEqual(result.messages, messages);
});
