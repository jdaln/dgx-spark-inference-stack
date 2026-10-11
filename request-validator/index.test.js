// Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.MODELS_CONFIG_PATH = path.resolve(__dirname, "../models.json");
process.env.VERBOSE = "0";

const { processBody, unsupportedSamplingParam, MODEL_CONFIG } = await import("./index.js");

// A lane shape the stack supports but no current model uses.
function syntheticLane(overrides) {
  return {
    modelId: "test-lane",
    host: "vllm-test-lane",
    port: 8000,
    maxModelLen: 262144,
    toolSupport: "full",
    validatorProfile: "default",
    thinkingDefault: "template",
    reasoningEffort: "passthrough",
    reasoningEffortDefault: null,
    backend: "vllm",
    lifecycle: "normal",
    multimodal: false,
    normalizeTextContent: false,
    speculativeDecoding: false,
    reasoningNeedsSpecialTokens: false,
    ...overrides
  };
}

const thinkingOffLane = syntheticLane({ thinkingDefault: "off", reasoningEffort: "binary" });

const gemmaTargetConfig = MODEL_CONFIG["gemma4-26b-a4b"];

function runProcess(payload, targetConfig = thinkingOffLane) {
  return JSON.parse(processBody(JSON.stringify(payload), targetConfig, "/v1/chat/completions"));
}

test("a thinkingDefault off lane defaults to non-thinking mode", () => {
  const result = runProcess({
    model: "test-lane",
    messages: [{ role: "user", content: "Reply with exactly READY" }],
    max_tokens: 64
  });

  assert.equal(result.thinking, undefined);
  assert.equal(result.chat_template_kwargs.enable_thinking, false);
  assert.equal(result.chat_template_kwargs.thinking, false);
  assert.equal(result.max_tokens, 64);
  // Not mirrored back: the client sent max_tokens, so that is what vLLM receives.
  assert.equal(result.max_completion_tokens, undefined);
  assert.deepEqual(result.messages, [{ role: "user", content: "Reply with exactly READY" }]);
});

test("tool calls are preserved under default non-thinking mode", () => {
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
    model: "test-lane",
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

test("binary lane: reasoning_effort none disables thinking", () => {
  const result = runProcess({
    model: "test-lane",
    messages: [{ role: "user", content: "Reply with exactly NONE" }],
    reasoning_effort: "none",
    max_tokens: 64
  });

  assert.equal(result.reasoning_effort, undefined);
  assert.equal(result.thinking, undefined);
  assert.equal(result.chat_template_kwargs.enable_thinking, false);
  assert.equal(result.chat_template_kwargs.thinking, false);
});

test("binary lane: camelCase reasoningEffort high enables thinking", () => {
  const result = runProcess({
    model: "test-lane",
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

test("binary lane: top-level thinking is normalized into chat_template_kwargs", () => {
  const result = runProcess({
    model: "test-lane",
    messages: [{ role: "user", content: "Reply with exactly READY" }],
    thinking: false,
    max_tokens: 64
  });

  assert.equal(result.thinking, undefined);
  assert.equal(result.chat_template_kwargs.enable_thinking, false);
  assert.equal(result.chat_template_kwargs.thinking, false);
});

test("reasoning effort fields pass through on lanes without a mapping", () => {
  const result = runProcess(
    {
      model: "gpt-oss-20b",
      messages: [{ role: "user", content: "Reply with exactly OK" }],
      reasoning: { effort: "high" },
      max_tokens: 64
    },
    MODEL_CONFIG["gpt-oss-20b"]
  );

  assert.deepEqual(result.reasoning, { effort: "high" });
  assert.equal(result.thinking, undefined);
});

// The validator does not budget tokens; vLLM sizes the budget from the real prompt.
test("a huge explicit max_tokens is passed through for vLLM to arbitrate", () => {
  const content = "x".repeat(800000);
  const result = runProcess({
    model: "test-lane",
    messages: [{ role: "user", content }],
    max_tokens: 999999
  });

  assert.equal(result.max_tokens, 999999);
});

test("a long CJK prompt is not given a gateway-computed budget", () => {
  // A chars/4 estimate undercounts CJK by ~3x and would inflate max_tokens into a 400.
  const result = runProcess({
    model: "test-lane",
    messages: [{ role: "user", content: "这是一个用于测试上下文长度限制的中文段落。".repeat(4000) }]
  });

  assert.equal(result.max_tokens, undefined);
  assert.equal(result.max_completion_tokens, undefined);
});

const llamaTargetConfig = syntheticLane({ validatorProfile: "llama-tools" });

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
      model: "test-lane",
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
    { model: "test-lane", messages, max_tokens: 64 },
    llamaTargetConfig
  );

  assert.deepEqual(result.messages, messages);
});

const qwen38DFlash2TargetConfig = MODEL_CONFIG["qwen3.8-27b-nvfp4-dflash2"];

test("Qwen 3.8 maps reasoning_effort high onto the template's xhigh", () => {
  const result = runProcess(
    {
      model: "qwen3.8-27b-nvfp4-dflash2",
      messages: [{ role: "user", content: "Is 91 prime?" }],
      reasoning_effort: "high",
      max_tokens: 256
    },
    qwen38DFlash2TargetConfig
  );

  assert.equal(result.reasoning_effort, "xhigh");
  assert.equal(result.chat_template_kwargs?.enable_thinking, undefined);
});

test("Qwen 3.8 passes through the efforts its template already supports", () => {
  for (const effort of ["low", "medium", "xhigh"]) {
    const result = runProcess(
      {
        model: "qwen3.8-27b-nvfp4-dflash2",
        messages: [{ role: "user", content: "Is 91 prime?" }],
        reasoning_effort: effort,
        max_tokens: 256
      },
      qwen38DFlash2TargetConfig
    );

    assert.equal(result.reasoning_effort, effort);
  }
});

test("Qwen 3.8 reasoning_effort none turns thinking off instead of sending an unsupported level", () => {
  const result = runProcess(
    {
      model: "qwen3.8-27b-nvfp4-dflash2",
      messages: [{ role: "user", content: "Is 91 prime?" }],
      reasoning_effort: "none",
      max_tokens: 256
    },
    qwen38DFlash2TargetConfig
  );

  assert.equal(result.reasoning_effort, undefined);
  assert.equal(result.chat_template_kwargs.enable_thinking, false);
  assert.equal(result.chat_template_kwargs.thinking, false);
});

test("Qwen 3.8 keeps an explicit thinking flag over reasoning_effort", () => {
  const result = runProcess(
    {
      model: "qwen3.8-27b-nvfp4-dflash2",
      messages: [{ role: "user", content: "Is 91 prime?" }],
      reasoning_effort: "high",
      chat_template_kwargs: { enable_thinking: false },
      max_tokens: 256
    },
    qwen38DFlash2TargetConfig
  );

  assert.equal(result.reasoning_effort, undefined);
  assert.equal(result.chat_template_kwargs.enable_thinking, false);
});

test("Qwen 3.8 keeps thinking on by default at the lane default effort (medium), not the template xhigh", () => {
  const result = runProcess(
    {
      model: "qwen3.8-27b-nvfp4-dflash2",
      messages: [{ role: "user", content: "Is 91 prime?" }],
      max_tokens: 256
    },
    qwen38DFlash2TargetConfig
  );

  assert.equal(result.reasoning_effort, "medium");
  assert.equal(result.chat_template_kwargs?.enable_thinking, undefined);
});

// --- token fields: normalization only, never budgeting -------------------------------
//
// vLLM rejects prompt + max_tokens above max_model_len, but with no max_tokens it rejects
// only a prompt that overflows on its own. So an absent max_tokens stays absent.

test("an absent max_tokens stays absent", () => {
  const result = runProcess({
    model: "test-lane",
    messages: [{ role: "user", content: "hello" }]
  });

  assert.equal(result.max_tokens, undefined);
  assert.equal(result.max_completion_tokens, undefined);
});

test("max_completion_tokens is normalized into max_tokens for vLLM", () => {
  const result = runProcess({
    model: "test-lane",
    messages: [{ role: "user", content: "hello" }],
    max_completion_tokens: 256
  });

  assert.equal(result.max_tokens, 256);
});

test("an explicit max_tokens wins over max_completion_tokens", () => {
  const result = runProcess({
    model: "test-lane",
    messages: [{ role: "user", content: "hello" }],
    max_tokens: 128,
    max_completion_tokens: 256
  });

  assert.equal(result.max_tokens, 128);
});

test("tool schemas no longer shrink the client's budget", () => {
  const tools = Array.from({ length: 12 }, (_, i) => ({
    type: "function",
    function: {
      name: `tool_number_${i}`,
      description: "x".repeat(400),
      parameters: { type: "object", properties: { arg: { type: "string" } } }
    }
  }));

  const result = runProcess({
    model: "test-lane",
    messages: [{ role: "user", content: "hi" }],
    tools,
    max_tokens: 4096
  });

  assert.equal(result.max_tokens, 4096);
});

// --- backend declaration --------------------------------------------------------------
//
// Leaving max_tokens to the engine is safe only on engines that size it from the prompt,
// so each lane declares its backend.

const { normalizeModelsConfig } = await import("../shared/models-config.mjs");

function normalizeOne(overrides = {}) {
  return normalizeModelsConfig(
    { "probe-model": { container: "vllm-probe", maxModelLen: 32768, ...overrides } },
    "<test>"
  ).byModel["probe-model"];
}

test("backend defaults to vllm", () => {
  assert.equal(normalizeOne().backend, "vllm");
});

test("a known non-vLLM backend is accepted", () => {
  assert.equal(normalizeOne({ backend: "sglang" }).backend, "sglang");
  assert.equal(normalizeOne({ backend: "llamacpp" }).backend, "llamacpp");
});

test("an unknown backend is rejected rather than silently inheriting vLLM semantics", () => {
  assert.throws(
    () => normalizeOne({ backend: "tensorrt-llm" }),
    /invalid backend 'tensorrt-llm'/
  );
});

// --- Qwen3.8 graded reasoning effort, abliterated lane ------------------------------------
//
// Same template as the NVFP4 lane: "high" must be mapped or the template returns a 400.

const huihuiQwen38TargetConfig = MODEL_CONFIG["huihui-qwen3.8-27b-abliterated"];

test("abliterated Qwen3.8 maps reasoning_effort high to the template's xhigh", () => {
  const result = runProcess({
    model: "huihui-qwen3.8-27b-abliterated",
    messages: [{ role: "user", content: "Think, then reply." }],
    reasoning_effort: "high"
  }, huihuiQwen38TargetConfig);

  assert.equal(result.reasoning_effort, "xhigh");
});

test("abliterated Qwen3.8 passes through the levels the template accepts", () => {
  for (const [sent, expected] of [["medium", "medium"], ["low", "low"], ["xhigh", "xhigh"]]) {
    const result = runProcess({
      model: "huihui-qwen3.8-27b-abliterated",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: sent
    }, huihuiQwen38TargetConfig);
    assert.equal(result.reasoning_effort, expected, `reasoning_effort ${sent}`);
  }
});

test("abliterated Qwen3.8 turns reasoning_effort none into thinking off", () => {
  const result = runProcess({
    model: "huihui-qwen3.8-27b-abliterated",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "none"
  }, huihuiQwen38TargetConfig);

  assert.equal(result.reasoning_effort, undefined);
  assert.equal(result.chat_template_kwargs.enable_thinking, false);
});

test("speculative lanes reject min_p and logit_bias, which vLLM would silently ignore", () => {
  const speculative = MODEL_CONFIG["qwen3.8-27b-nvfp4-dflash2"];
  assert.equal(speculative.speculativeDecoding, true);
  const check = (payload, config = speculative) => unsupportedSamplingParam(JSON.stringify(payload), config);
  assert.equal(check({ model: "x", min_p: 0.05 }), "min_p");
  assert.equal(check({ model: "x", logit_bias: { 42: -100 } }), "logit_bias");
  assert.equal(check({ model: "x", min_p: 0, logit_bias: {} }), null);
  assert.equal(check({ model: "x", temperature: 0.7, top_p: 0.9, top_k: 20 }), null);
  assert.equal(check({ model: "x", min_p: 0.05 }, MODEL_CONFIG["gpt-oss-20b"]), null);
});

test("graded lane default reasoning effort applies only when the caller states none", () => {
  const lane = MODEL_CONFIG["qwen3.8-27b-nvfp4-dflash2"];
  assert.equal(lane.reasoningEffortDefault, "medium");
  const run = (payload) => runProcess({ model: "qwen3.8-27b-nvfp4-dflash2", messages: [{ role: "user", content: "hi" }], ...payload }, lane);
  assert.equal(run({}).reasoning_effort, "medium");
  assert.equal(run({ reasoning_effort: "high" }).reasoning_effort, "xhigh");
  assert.equal(run({ reasoning_effort: "low" }).reasoning_effort, "low");
  const off = run({ reasoning_effort: "none" });
  assert.equal(off.reasoning_effort, undefined);
  assert.equal(off.chat_template_kwargs.enable_thinking, false);
  const explicit = run({ chat_template_kwargs: { enable_thinking: true } });
  assert.equal(explicit.reasoning_effort, undefined);
  assert.equal(explicit.chat_template_kwargs.enable_thinking, true);
  const noDefault = { ...lane, reasoningEffortDefault: undefined };
  assert.equal(runProcess({ model: "qwen3.8-27b-nvfp4-dflash2", messages: [{ role: "user", content: "hi" }] }, noDefault).reasoning_effort, undefined);
});

test("Gemma lanes map reasoning_effort onto the template's thinking switch", () => {
  for (const model of ["gemma4-26b-a4b", "gemma4-31b"]) {
    const lane = MODEL_CONFIG[model];
    assert.equal(lane.reasoningEffort, "binary");
    const run = (payload) => runProcess({ model, messages: [{ role: "user", content: "hi" }], ...payload }, lane);
    assert.equal(run({ reasoning_effort: "high" }).chat_template_kwargs.enable_thinking, true);
    assert.equal(run({ reasoning_effort: "low" }).chat_template_kwargs.enable_thinking, true);
    assert.equal(run({ reasoning_effort: "none" }).chat_template_kwargs.enable_thinking, false);
    assert.equal(lane.thinkingDefault, "off");
    // No effort stated: thinking off, sent explicitly.
    assert.equal(run({}).chat_template_kwargs.enable_thinking, false);
    assert.equal(run({}).reasoning_effort, undefined);
    // Thinking on, non-streaming: special tokens are kept. Other cases are left alone.
    assert.equal(run({ reasoning_effort: "high" }).skip_special_tokens, false);
    assert.equal(run({ chat_template_kwargs: { enable_thinking: true } }).skip_special_tokens, false);
    assert.equal(run({ reasoning_effort: "high", stream: true }).skip_special_tokens, undefined);
    assert.equal(run({ reasoning_effort: "none" }).skip_special_tokens, undefined);
    assert.equal(run({}).skip_special_tokens, undefined);
    assert.equal(run({ reasoning_effort: "high", skip_special_tokens: true }).skip_special_tokens, true);
    // The native switch still works and wins over reasoning_effort.
    for (const flag of [true, false]) {
      assert.equal(run({ chat_template_kwargs: { enable_thinking: flag } }).chat_template_kwargs.enable_thinking, flag);
      assert.equal(run({ chat_template_kwargs: { enable_thinking: flag }, reasoning_effort: flag ? "none" : "high" }).chat_template_kwargs.enable_thinking, flag);
    }
  }
});
