# Integration Guides

## Cline Integration Guide

To use this stack with the [Cline](https://github.com/cline/cline) VS Code extension:

1. **API Provider**: Select `OpenAI Compatible`.
2. **Base URL**: `http://localhost:8009/v1` (or `http://127.0.0.1:8009/v1`).
3. **API Key**: Enter your `VLLM_API_KEY` (default: `63TestTOKEN0REPLACEME`).
4. **Model ID**: Enter the served model name from the table below.
5. **Context Window**: Use the exact value from the table below for the selected model.

### Recommended Settings for Cline

Start with the validated defaults below. If you want a broader catalog or are deliberately opting into an experimental lane, read [the model guide](./models.md) first and then add the model manually.

| Model ID | Context Window | Best Use Case |
|----------|----------------|---------------|
| `gpt-oss-20b` | `131072` | Best default chat / general assistant |
| `gpt-oss-120b` | `131072` | Best overall quality |
| `glm-4.7-flash-awq` | `131072` | Best current long-context coding/chat path |
| `qwen3.6-35b-a3b-fp8-mtp` | `240000` | Current OSS SOTA long-context text/tool opt-in lane |
| `qwen3.6-27b-fp8` | `240000` | Cheaper Qwen 3.6 opt-in baseline |
| `gemma4-26b-a4b` | `240000` | Current OSS SOTA multimodal/tool opt-in lane for its size class |

If you need a vision-capable lane in Cline, `gemma4-26b-a4b` is the current repo-local choice with the clearest text+image and tool-calling evidence, and it is one of the repo's main OSS SOTA opt-in families for this size range, but it remains explicitly experimental.

If you specifically want the repo's current OSS SOTA text/tool lane in Cline, start with `qwen3.6-35b-a3b-fp8-mtp` and keep a larger completion budget when you deliberately enable reasoning. If you want the corresponding multimodal OSS SOTA lane for this size class, start with `gemma4-26b-a4b`.

> [!IMPORTANT]
> **Context Window Accuracy**: It is critical that your Cline settings for "Context Window" match the values in this table. The request validator middleware automatically fixes minor overflows, but setting it correctly in Cline ensures optimal performance and prevents unnecessary token capping.

> [!TIP]
> If you encounter "Connection error", ensure that you have port-forwarded `8009` if working remotely. If you get an "Invalid API Response" error, it may be due to tool calls that Cline cannot process; the request validator may automatically strip these to improve compatibility.

## OpenCode Integration Guide

To use this stack with [OpenCode](https://github.com/opencode-ai/opencode), follow the instructions below:

### Quick Start

1. **Use the included configuration** (`opencode.json` in project root):
  The repository includes a curated `opencode.json` using the `dgx` provider. It is intentionally **not** a mirror of every model in the repo. The conservative defaults remain `gpt-oss-20b`, `gpt-oss-120b`, and `glm-4.7-flash-awq`, plus the small `qwen3.5-0.8b` utility helper. The checked-in `model` is currently `dgx/gemma4-26b-a4b`: that lane is still explicitly experimental, but it has the strongest current multimodal and tool-calling evidence in OpenCode on this stack and is one of the repo's main OSS SOTA opt-in families for its size class. Qwen 3.6 is the corresponding OSS SOTA long-context text/tool family here, especially `qwen3.6-35b-a3b-fp8-mtp`. Additional experimental lanes stay in the file as opt-in entries, not blanket recommendations.

2. **If your endpoint or API key is different, edit the provider block**:
  Update `provider.dgx.options.baseURL` and `provider.dgx.options.apiKey` in `opencode.json` before launching OpenCode.

3. **Run OpenCode**:
   ```bash
   opencode
   ```

4. **Configuration Structure**:
  The checked-in `opencode.json` uses the local DGX Spark stack as the primary provider. The core provider/model shape looks like this:
   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "enabled_providers": ["dgx"],
     "provider": {
       "dgx": {
         "npm": "@ai-sdk/openai-compatible",
         "name": "DGX Spark (local)",
         "options": {
           "baseURL": "http://localhost:8009/v1",
           "apiKey": "63TestTOKEN0REPLACEME"
         },
         "models": {
           "gpt-oss-20b": { "name": "GPT-OSS 20B", "limit": { "context": 108000, "output": 8192 } },
           "gpt-oss-120b": { "name": "GPT-OSS 120B", "limit": { "context": 108000, "output": 8192 } },
           "gemma4-26b-a4b": { "name": "Gemma 4 26B A4B", "reasoning": true, "tool_call": true, "experimental": true, "limit": { "context": 240000, "output": 8192 }, "options": { "temperature": 1, "top_p": 0.95, "top_k": 64 } },
           "glm-4.7-flash-awq": { "name": "GLM-4.7 Flash AWQ", "limit": { "context": 108000, "output": 8192 } },
           "qwen3.5-0.8b": { "name": "Qwen 3.5 0.8B Utility", "limit": { "context": 8192, "output": 2048 } }
           // ... other explicitly experimental opt-in entries omitted here
         }
       }
     },
     "model": "dgx/gemma4-26b-a4b",
     "small_model": "dgx/qwen3.5-0.8b",
     "compaction": { "auto": false },
     "logLevel": "ERROR"
   }
   ```

### Switching Models

To switch the active models, edit the `model` and `small_model` fields in `opencode.json` using the `dgx/<model-id>` format.

| Role | Recommended Starting Point | Context | Notes |
|------|----------------------------|---------|-------|
| `model` | `dgx/gemma4-26b-a4b` | `240000` | Checked-in default; experimental, but the main OSS SOTA multimodal/tool path for this size class on this stack |
| `model` | `dgx/gpt-oss-20b` | `108000` | Conservative default for general tasks |
| `model` | `dgx/gpt-oss-120b` | `108000` | Conservative higher-quality default |
| `model` | `dgx/glm-4.7-flash-awq` | `108000` | Conservative long-context coding path |
| `model` | `dgx/qwen3.6-35b-a3b-fp8-mtp` | `240000` | Current OSS SOTA long-context text/tool opt-in lane when you want the strongest Qwen 3.6 path |
| `model` | `dgx/qwen3.6-27b-fp8` | `240000` | Smaller Qwen 3.6 baseline with the same official recipe family |
| `small_model` | `dgx/qwen3.5-0.8b` | `8192` | Validated utility helper for session titles |

The shipped file also contains a small set of explicitly experimental opt-in entries, including the Gemma variants, Qwen 3.6 lanes, Huihui Qwen lane, and Qwen coder-next lane. Use the limits already encoded in `opencode.json`, then cross-check [the model guide](./models.md) before promoting one of them to your daily default.

> [!IMPORTANT]
> The `opencode.json` limits are **OpenCode-safe guidance**, not raw server maxima. For the currently validated `131072`-class models in the shipped config, the repo now uses `108000` as the conservative client-facing ceiling. That leaves room for prompt wrapper overhead, validator safety margin, and a real completion instead of a one-token answer near the hard cap.

> [!TIP]
> The checked-in `model` is intentionally still `dgx/gemma4-26b-a4b`, because that lane currently has the strongest OpenCode evidence for combined multimodal input, tool calling, and a higher interactive ceiling. If you want a conservative default instead of an experimental one, switch `model` to `dgx/gpt-oss-20b`, `dgx/gpt-oss-120b`, or `dgx/glm-4.7-flash-awq`.

> [!TIP]
> The shipped `small_model` now uses the validated `qwen3.5-0.8b` SGLang utility path inspired by Patrick Yi / scitrera.ai. The underlying checkpoint supports vision and thinking mode upstream, but the repo currently keeps this path intentionally narrow: utility-only role, conservative `8192` OpenCode limit, and no promotion as a general chat default.

> [!TIP]
> You do not need to add any special OpenCode request flags for GLM 4.7 on current repo revisions. The request validator disables hidden thinking by default for `glm-4.7-flash-awq`, specifically because the default parser mode consumed the visible answer budget during long-context OpenCode-style requests.

> [!TIP]
> The explicitly experimental entries in `opencode.json` remain opt-in. For the repo's current OSS SOTA families, start with `qwen3.6-35b-a3b-fp8-mtp` for long-context text/tool use or `gemma4-26b-a4b` for multimodal work in this size class. Use the shipped limits as conservative ceilings, and expect to raise completion budgets if you deliberately enable reasoning-heavy Qwen modes.

> [!WARNING]
> On Linux, OpenCode still has a client-side image-input bug. Vision models can remain listed in `opencode.json` for non-Linux users or for future fixes, but clipboard/file-path images are still unreliable on Linux OpenCode sessions today.

> [!TIP]
> For remote access, ensure you've set up SSH port forwarding for port `8009` as described in the [Remote Access section](./security.md#remote-access--ssh-hardening).
