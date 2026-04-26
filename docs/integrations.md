# Integration Guides

## Cline Integration Guide

To use this stack with the [Cline](https://github.com/cline/cline) VS Code extension:

1. **API Provider**: Select `OpenAI Compatible`.
2. **Base URL**: `http://localhost:8009/v1` (or `http://127.0.0.1:8009/v1`).
3. **API Key**: Enter your `VLLM_API_KEY` (default: `63TestTOKEN0REPLACEME`).
4. **Model ID**: Enter the served model name from the table below.
5. **Context Window**: Use the exact value from the table below for the selected model.

### Recommended Settings for Cline

| Model ID | Context Window | Best Use Case |
|----------|----------------|---------------|
| `gpt-oss-20b` | `131072` | Best default chat / general assistant |
| `gpt-oss-120b` | `131072` | Best overall quality |
| `qwen3-next-80b-a3b-instruct-fp4` | `131072` | Fast general chat at scale |
| `qwen3-next-80b-a3b-thinking-fp4` | `131072` | Heavy reasoning (math, logic, planning) |
| `qwen3-vl-32b-instruct-fp4` | `131072` | Best quality VL for docs + screenshots |
| `glm-4.5-air-fp4` | `131072` | Great general assistant alternative |
| `glm-4.6v-flash-fp4` | `131072` | Fastest VL for real-time UI workflows |
| `glm-4.5-air-derestricted-fp4` | `131072` | Fewer refusals, creative/roleplay |
| `llama-3.3-70b-joyous-fp4` | `131072` | High-quality general assistant |
| `llama-3.3-70b-instruct-fp4` | `131072` | Standard Llama 3.3 70B |
| `nemotron-3-nano-30b-nvfp4` | `100000` | Efficient MoE reasoning + long-context (experimental, manual add only) |
| `nemotron-nano-12b-v2-vl` | `131072` | Lightweight vision assistant |
| `qwen3-vl-30b-instruct` | `65536` | New Qwen3 Vision-Language model |
| `qwen3-vl-30b-thinking-instruct` | `65536` | Complex visual reasoning with thinking |
| `qwen3-coder-30b-a3b-instruct` | `65536` | Long-context coding + tool usage |
| `eurollm-22b-instruct-fp4` | `32768` | EU languages / multilingual support |
| `phi-4-multimodal-instruct-fp4` | `32768` | Text+image(+audio) multimodal |
| `phi-4-reasoning-plus-fp4` | `32768` | Careful/robust reasoning style |
| `qwen2.5-vl-7b` | `32768` | Cheapest practical VL |
| `glm-4-9b-chat` | `32768` | Cheap chat, lightweight assistant |
| `qwen2.5-coder-7b-instruct` | `32768` | Budget coding assistant |
| `qwen3.5-0.8b` | `32768` | Validated small utility helper for titles/classification |
| `qwen-math` | `4096` | Math specialist |

> [!IMPORTANT]
> **Context Window Accuracy**: It is critical that your Cline settings for "Context Window" match the values in this table. The request validator middleware automatically fixes minor overflows, but setting it correctly in Cline ensures optimal performance and prevents unnecessary token capping.

> [!TIP]
> If you encounter "Connection error", ensure that you have port-forwarded `8009` if working remotely. If you get an "Invalid API Response" error, it may be due to tool calls that Cline cannot process; the request validator may automatically strip these to improve compatibility.

## OpenCode Integration Guide

To use this stack with [OpenCode](https://github.com/opencode-ai/opencode), follow the instructions below:

### Quick Start

1. **Use the included configuration** (`opencode.json` in project root):
  The repository includes a curated `opencode.json` using the `dgx` provider. It is intentionally **not** a mirror of every model in the repo. The shipped OpenCode config primarily exposes the models we have actually validated with the current harness for normal OpenCode-style use: `gpt-oss-20b`, `gpt-oss-120b`, and `glm-4.7-flash-awq`, plus the small utility model used for titles. It also includes a small number of explicitly marked experimental entries when there is enough evidence for a practical manual ceiling but not yet enough broader quality validation for promotion, including the newly validated Qwen 3.6 baseline and MTP model variants.

2. **If your endpoint or API key is different, edit the provider block**:
  Update `provider.dgx.options.baseURL` and `provider.dgx.options.apiKey` in `opencode.json` before launching OpenCode.

3. **Run OpenCode**:
   ```bash
   opencode
   ```

4. **Configuration Structure**:
  The checked-in `opencode.json` is configured to use the local DGX Spark stack as the primary provider:
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
           "glm-4.7-flash-awq": { "name": "GLM-4.7 Flash AWQ", "limit": { "context": 108000, "output": 8192 } }
           // ... (see opencode.json in project root for full model list)
         }
       }
     },
     "model": "dgx/gpt-oss-20b",
    "small_model": "dgx/qwen3.5-0.8b",
     "compaction": { "auto": false },
     "logLevel": "INFO"
   }
   ```

### Switching Models

To switch the active models, edit the `model` and `small_model` fields in `opencode.json` using the `dgx/<model-id>` format.

| Role | Recommended Model | Context | Use Case |
|------|-------------------|---------|----------|
| `model` | `dgx/gpt-oss-20b` | `108000` | Balanced quality/speed for general tasks |
| `model` | `dgx/gpt-oss-120b` | `108000` | Higher-quality default when you want a larger model |
| `model` | `dgx/gemma4-26b-a4b` | `240000` | Experimental Gemma path with verified image input, tool calling, and a much higher multi-user-tested interactive ceiling |
| `model` | `dgx/glm-4.7-flash-awq` | `108000` | Best current long-context coding path in OpenCode |
| `model` | `dgx/huihui-qwen3.5-35b-a3b-abliterated` | `200000` | Experimental long-context general/tool model with much stronger richer-prompt evidence than the other experimental Qwen variants |
| `model` | `dgx/qwen3.6-27b-fp8` | `240000` | Experimental Qwen 3.6 baseline model with validated plain chat, tool calling, explicit thinking, and a much larger 262k-class context target |
| `model` | `dgx/qwen3.6-27b-fp8-mtp` | `240000` | Experimental Qwen 3.6 MTP model variant for latency comparisons against the 27B baseline on the same 262k-class context target |
| `model` | `dgx/qwen3.6-35b-a3b-fp8` | `240000` | Experimental larger Qwen 3.6 model with validated helper coexistence, explicit thinking, and long-context soak coverage at the tuned `0.84` memory envelope |
| `model` | `dgx/qwen3.6-35b-a3b-fp8-mtp` | `240000` | Experimental larger Qwen 3.6 MTP model variant with the same tuned `0.84` envelope, helper coexistence, and better measured latency than the 35B baseline on this host |
| `model` | `dgx/qwen3-coder-next-int4-autoround` | `524000` | Experimental long-context coder path; current ceiling is based on a minimal retention probe, not richer summarization-quality validation |
| `small_model` | `dgx/qwen3.5-0.8b` | `8192` | Validated utility helper for session titles |

> [!IMPORTANT]
> The `opencode.json` limits are **OpenCode-safe guidance**, not raw server maxima. For the currently validated `131072`-class models in the shipped config, the repo now uses `108000` as the conservative client-facing ceiling. That leaves room for prompt wrapper overhead, validator safety margin, and a real completion instead of a one-token answer near the hard cap.

> [!TIP]
> The Gemma 26B entry carries the easy published Gemma sampling guidance directly in `opencode.json`: `temperature=1.0`, `top_p=0.95`, and `top_k=64`. Its first five-user run at a `256` completion cap was conservative and misleading: with `max_completion_tokens=1024`, richer five-user stack-summary probes now pass at roughly `145990`, `194614`, and `243238` prompt tokens. The shipped OpenCode ceiling is therefore raised to `240000`, while the model remains explicitly experimental.

> [!TIP]
> The shipped `small_model` now uses the validated `qwen3.5-0.8b` SGLang utility path inspired by Patrick Yi / scitrera.ai. The underlying checkpoint supports vision and thinking mode upstream, but the repo currently keeps this path intentionally narrow: utility-only role, conservative `8192` OpenCode limit, and no promotion as a general chat default.

> [!TIP]
> You do not need to add any special OpenCode request flags for GLM 4.7 on current repo revisions. The request validator  disables hidden thinking by default for `glm-4.7-flash-awq`, specifically because the default parser mode consumed the visible answer budget during long-context OpenCode-style requests.

> [!TIP]
> `qwen3.6-27b-fp8`, `qwen3.6-27b-fp8-mtp`, `qwen3.6-35b-a3b-fp8`, and `qwen3.6-35b-a3b-fp8-mtp` are now listed in the shipped `opencode.json` as explicitly experimental Qwen 3.6 entries with a `240000` OpenCode ceiling. The underlying vLLM services keep the recipe's raw `262144` token window, but the shipped client limit stays lower so prompts still leave practical room for a real completion. Normal OpenCode and gateway requests stay in non-thinking mode by default so visible final answers and structured `tool_calls` surface reliably. If OpenCode sends a reasoning-effort override, the validator maps that onto Qwen's binary thinking controls on this stack: `none` keeps non-thinking, while any other recognized effort enables thinking. Deliberate thinking works, but it consumes completion budget quickly, especially on the MTP model variants, so use a larger output cap when you enable it.

> [!TIP]
> `huihui-qwen3.5-35b-a3b-abliterated` is now listed in the shipped `opencode.json`, but it stays explicitly experimental. Its `200000` ceiling is conservative relative to the current richer five-user stack-summary evidence, which stayed clean through roughly `253603` prompt tokens with `1024` completion tokens. Manual reads remained coherent, but they still tended to flatten the mixed lifecycle story into pure single-tenancy and to drift toward generic scaling advice, so treat it as an opt-in long-context general/tool lane rather than a promoted default.

> [!TIP]
> `qwen3-coder-next-int4-autoround` is now listed in the shipped `opencode.json`, but it stays explicitly experimental. The current `524000` ceiling is based on a five-user gateway-path minimal retention probe that asked the model to reply with `ok.` after a very large filler context. That probe stayed clean through roughly `524382` prompt tokens, but the richer default stack-summary soak prompt still looped into repeated headings or punctuation even at much lower context. Treat it as an opt-in long-context coder lane, not as a promoted default.

> [!TIP]
> `nemotron-3-nano-30b-nvfp4` is still intentionally omitted from the shipped OpenCode config, but the current active-stack soak results are now good enough to give a first manual client ceiling: use `100000` as the conservative context limit for now. Five concurrent gateway-path requests passed with visible content at approximately `29166`, `58210`, and `101776` prompt tokens, while the next tested tier at approximately `116298` prompt tokens was already borderline because one request fell just under the 256-token completion floor.

> [!WARNING]
> On Linux, OpenCode still has a client-side image-input bug. Vision models can remain listed in `opencode.json` for non-Linux users or for future fixes, but clipboard/file-path images are still unreliable on Linux OpenCode sessions today.

> [!TIP]
> For remote access, ensure you've set up SSH port forwarding for port `8009` as described in the [Remote Access section](./security.md#remote-access--ssh-hardening).
