import assert from "node:assert/strict";
import test from "node:test";

const gatewayUrl = process.env.GATEWAY_URL ?? "http://127.0.0.1:8009";
const apiKey = process.env.VLLM_API_KEY ?? "63TestTOKEN0REPLACEME";
const modelId = process.env.MODEL_ID ?? "dolphin-mistral-24b-venice-fp8";
const requestTimeoutMs = Number.parseInt(
  process.env.REQUEST_TIMEOUT_MS ?? "1800000",
  10,
);

async function postChatCompletion(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const rawBody = await response.text();
    let body;

    try {
      body = JSON.parse(rawBody);
    } catch {
      assert.fail(`Expected JSON response, got: ${rawBody}`);
    }

    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

test(
  "Dolphin gateway tool calls stay structured",
  { timeout: requestTimeoutMs + 5000 },
  async () => {
    const { response, body } = await postChatCompletion({
      model: modelId,
      messages: [
        {
          role: "user",
          content: "What is the weather in Paris today? Use the provided tool if needed.",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get current weather by city",
            parameters: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
            },
          },
        },
      ],
      tool_choice: "auto",
      max_tokens: 128,
      temperature: 0,
      stream: false,
    });

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.ok(Array.isArray(body.choices), JSON.stringify(body));
    assert.ok(body.choices.length > 0, JSON.stringify(body));

    const choice = body.choices[0];
    assert.equal(choice.finish_reason, "tool_calls", JSON.stringify(body));
    assert.equal(choice.message.content, null, JSON.stringify(body));
    assert.ok(Array.isArray(choice.message.tool_calls), JSON.stringify(body));
    assert.equal(choice.message.tool_calls.length, 1, JSON.stringify(body));
    assert.equal(choice.message.tool_calls[0].function.name, "get_weather", JSON.stringify(body));
    assert.deepEqual(
      JSON.parse(choice.message.tool_calls[0].function.arguments),
      { city: "Paris" },
      JSON.stringify(body),
    );
  },
);
