# Integrations

Client setup for Cline, OpenCode and pi. Every client uses the same endpoint:
`http://localhost:8009/v1`, with `VLLM_API_KEY` as the bearer token (default
`63TestTOKEN0REPLACEME`). From another machine, forward port 8009 over SSH first: see
[security.md](security.md#remote-access).

Model ids and context sizes: [models.md](models.md).

## Cline (VS Code)

1. API Provider: `OpenAI Compatible`.
2. Base URL: `http://localhost:8009/v1`.
3. API Key: your `VLLM_API_KEY`.
4. Model ID: a model id, for example `qwen3.8-27b-nvfp4-dflash2`.
5. Context Window: the model's `limit.context` in [`opencode.json`](../opencode.json).

- "Connection error": port 8009 is not reachable from the client; check the SSH tunnel.
- "Invalid API Response": Cline could not parse a tool call; try another model.

## OpenCode

[`opencode.json`](../opencode.json) in the repo root defines a `dgx` provider with 8
models and their limits. The main model is `dgx/qwen3.8-27b-nvfp4-dflash2`, the small
model `dgx/lfm2.5-1.2b`. Models without validation evidence are left out.

If your endpoint or key differ, edit `provider.dgx.options.baseURL` and
`provider.dgx.options.apiKey`. To switch models, set `model` and `small_model` to
`dgx/<model-id>`.

On Linux, OpenCode's image input from clipboard and file paths is unreliable.

## pi

Copy the provider config into pi's registry:

```bash
mkdir -p ~/.pi/agent
cp integrations/pi/models.json ~/.pi/agent/models.json
```

If you already have a registry, merge the `dgx` block instead. The file lists the same
models and limits as `opencode.json`, with `input: ["text", "image"]` on multimodal models.
Replace the shipped `apiKey` with `"$VLLM_API_KEY"` to read it from the environment.

## Client notes

- Roster context limits are the measured client ceilings, at most the served context.
  Output is capped at 8192 tokens, less on small models.
- `reasoning: true` in a roster marks models where the validator maps `reasoning_effort`
  onto the model's thinking switch.
- The Qwen3.8 models default to `medium` effort. Send `reasoning_effort: "xhigh"` (or
  `"high"`) for complex tasks; `low` and `none` also work.
