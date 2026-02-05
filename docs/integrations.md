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
| `llama-3.3-70b-joyous-fp4` | `131072` | High-quality general assistant |
| `llama-3.3-70b-instruct-fp4` | `131072` | Standard Llama 3.3 70B |
| `deepseek-r1-distill-qwen-14b` | `128000` | Reasoning on a budget |
| `deepseek-r1-distill-qwen-32b` | `128000` | Strong reasoning + planning |
| `nemotron-3-nano-30b-fp8` | `131072` | Efficient MoE reasoning + long-context |
| `eurollm-22b-instruct-fp4` | `32768` | EU languages / multilingual support |
| `qwen2.5-1.5b-instruct` | `8192` | Small utility model for titles/classification |
| `phi-4-multimodal-instruct-fp4` | `32768` | Text+image(+audio) multimodal |
| `phi-4-reasoning-plus-fp4` | `32768` | Careful/robust reasoning style |
| `qwen2.5-vl-7b` | `32768` | Cheapest practical VL |
| `deepseek-ocr` | `32768` | Best for raw text extraction |
| `glm-4-9b-chat` | `32768` | Cheap chat, lightweight assistant |
| `qwen3-coder-30b-a3b-instruct` | `32768` | Long-context coding + tool usage |
| `qwen2.5-coder-7b-instruct` | `32768` | Budget coding assistant |
| `qwen-math` | `32768` | Math specialist |

> [!IMPORTANT]
> **Context Window Accuracy**: It is critical that your Cline settings for "Context Window" match the values in this table. The request validator middleware automatically fixes minor overflows, but setting it correctly in Cline ensures optimal performance and prevents unnecessary token capping.

> [!TIP]
> If you encounter "Connection error", ensure that you have port-forwarded `8009` if working remotely. If you get an "Invalid API Response" error, it may be due to tool calls that Cline cannot process; the request validator may automatically strip these to improve compatibility.

## OpenCode Integration Guide

To use this stack with [OpenCode](https://github.com/opencode-ai/opencode), follow the instructions below:

### Quick Start

1. **Set the endpoint environment variable**:
   ```bash
   export LOCAL_ENDPOINT=http://localhost:8009/v1 # or hardcode in .opencode.json
   ```

2. **Use the included configuration** (`.opencode.json` in project root):
   The repository includes a pre-configured `.opencode.json` using the `dgx` provider. Simply run:
   ```bash
   opencode
   ```

3. **Configuration Structure**:
   The `.opencode.json` is configured to use the local DGX Spark stack as the primary provider:
   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "enabled_providers": ["dgx"],
     "provider": {
       "dgx": {
         "npm": "@ai-sdk/openai-compatible",
         "name": "DGX Spark (local)",
         "options": {
           "baseURL": "{env:LOCAL_ENDPOINT}",
           "apiKey": "local"
         },
         "models": {
           "gpt-oss-20b": { "name": "GPT-OSS 20B", "limit": { "context": 131072, "output": 8192 } },
           "iquest-coder-v1-40b-instruct-fp4": { "name": "iQuest Coder v1 40B Instruct (FP4)", "limit": { "context": 131072, "output": 8192 } }
           // ... (all 29 models included)
         }
       }
     },
     "model": "dgx/gpt-oss-20b",
     "small_model": "dgx/qwen2.5-1.5b-instruct",
     "compaction": { "auto": false },
     "logLevel": "INFO"
   }
   ```

### Switching Models

To switch the active models, edit the `model` and `small_model` fields in `.opencode.json` using the `dgx/<model-id>` format.

| Role | Recommended Model | Use Case |
|------|-------------------|----------|
| `model` | `dgx/gpt-oss-20b` | Balanced quality/speed for general tasks |
| `small_model` | `dgx/qwen2.5-1.5b-instruct` | Small model for session titles |

> [!TIP]
> For remote access, ensure you've set up SSH port forwarding for port `8009` as described in the [Remote Access section](./security.md#remote-access--ssh-hardening).
