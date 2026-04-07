# Model Selection Guide

Choose the right model for your task to balance performance and speed.

> [!WARNING]
> This document is **100% AI generated** and might need improvements.

> [!IMPORTANT]
> Current status vocabulary in this repo:
> - **Validated main models**: `gpt-oss-20b`, `gpt-oss-120b`, and `glm-4.7-flash-awq`
> - **Validated utility helper**: `qwen3.5-0.8b` for titles/session metadata
> - **Experimental**: everything else until the current harness re-validates it
> - **Manual-only on this host**: `gemma4-31b`, which is currently too slow for interactive use and is intentionally omitted from the shipped OpenCode config
>
> That means availability in compose or `models.json` does **not** automatically mean “recommended default”.

## Quick chooser (what to use for what)

### ✅ Best default chat / general assistant
- **`gpt-oss-20b`** → fast + strong quality for most tasks
- **`gpt-oss-120b`** → best overall quality when latency/cost is okay
- **`glm-4.7-flash-awq`** → validated long-context coding/chat path on the current harness
- **`glm-4.5-air-fp4`** → promising general assistant alternative, but still experimental on the current harness


### 🧠 Heavy reasoning (math, logic, planning, step-by-step)
- **`qwen3-next-80b-a3b-thinking-fp4`** → fast MoE “thinking” model (high throughput)
- **`deepseek-r1-distill-qwen-32b`** → very strong reasoning per GPU
- **`phi-4-reasoning-plus-fp4`** → careful/robust reasoning style
- **`nemotron-3-nano-30b-nvfp4`** → efficient MoE reasoning + long-context workloads, re-enabled on the refreshed standard track but still experimental on the current harness

### 💻 Coding / repo edits / tool-assisted programming
- **`glm-4.7-flash-awq`** → validated long-context coding path right now
- **`qwen3-coder-30b-a3b-instruct`** → strong coding model, but still experimental on the current harness
- **`qwen2.5-coder-7b-instruct`** → budget coding assistant, experimental and not recommended for OpenCode

### 👁️ Vision (screenshots, UI, diagrams, “look at this image”)
- **`qwen3-vl-32b-instruct-fp4`** → best-looking VL candidate in the repo, but still experimental on the current harness
- **`qwen3-vl-30b-instruct`** → available, but still experimental on the current harness
- **`gemma4-26b-a4b`** → experimental Gemma path with verified text+image input and tool calling on the current stack

- **`glm-4.6v-flash-fp4`** → fastest VL candidate for real-time UI workflows, but still experimental on the current harness
- **`phi-4-multimodal-instruct-fp4`** → solid “one model for text+image(+audio)”
- **`qwen2.5-vl-7b`** → cheapest practical VL

### 🔎 OCR (image → raw text extraction)
- **`deepseek-ocr`** → best when you need clean extracted text

### 🎧 Audio
- **`step-audio-r1-fp4`** → audio understanding + reasoning (Disabled)

### 🌍 EU languages / multilingual support
- **`eurollm-22b-instruct-fp4`** → EU-language focused assistant

### 🪶 Small “utility model”
- **`qwen3.5-0.8b`** → validated small helper for classification, formatting, tagging, and session titles

---

## Model Details

### OpenAI GPT-OSS (general-purpose text)

- `vllm-oss20b` → served as **`gpt-oss-20b`**
  - **Type:** general-purpose text
  - **Best for:** everyday assistant, summarization, RAG answers, email drafting, planning
  - **Strengths:** strong quality/latency balance, reliable instruction-following
  - **Tradeoffs:** not the absolute best at deep multi-step reasoning
  - **Endpoints:**
    - ✅ `/v1/responses` *(tool use: browsing, python, MCP)*
    - ✅ `/v1/chat/completions` *(reasoning + text output)*
    - ✅ `/v1/completions` *(simple I/O)*

    **Example: Tool Use Request**
    ```bash
    curl -sS -X POST http://localhost:8009/v1/gpt-oss-20b/responses \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${VLLM_API_KEY}" \
      -d '{
        "model": "gpt-oss-20b",
        "input": [
          {
            "role": "user",
            "content": [
              { "type": "text", "text": "Search for latest AI news" }
            ]
          }
        ]
      }'
    ```

- `vllm-oss120b` → served as **`gpt-oss-120b`**
  - **Type:** large general-purpose text
  - **Best for:** best answer quality, harder writing + synthesis, complex instruction-following
  - **Strengths:** higher ceiling than 20B for tricky prompts
  - **Tradeoffs:** slower + more expensive
  - **Endpoints:** same as `gpt-oss-20b`

### Llama 3.3 (Meta)

- `vllm-llama-3.3-70b-instruct-fp4` → served as **`llama-3.3-70b-instruct-fp4`**
  - **Type:** open-weights general model (70B), NVFP4
  - **Best for:** general chat, creative writing, complex instructions
  - **Tradeoffs:** **⚠️ Not recommended for OpenCode** (client-side incompatibility causes aggressive tool calling errors).
  - **Note:** Works well via standard API/Curl, but open-source agents may struggle with its tool format.

### Qwen3-Next 80B-A3B (MoE efficiency)

- `vllm-qwen3-next-80b-fp4` → served as **`qwen3-next-80b-a3b-instruct-fp4`**
  - **Type:** MoE (≈80B total, ~3B active), NVFP4
  - **Best for:** fast general chat at scale, long prompts, multi-turn workflows
  - **Strengths:** excellent throughput for its “effective size”
  - **Tradeoffs:** can be less careful than “thinking” variants on hard reasoning

- `vllm-qwen3-next-80b-thinking-fp4` → served as **`qwen3-next-80b-a3b-thinking-fp4`**
  - **Type:** MoE “thinking”/reasoning variant, NVFP4
  - **Best for:** math, logic, planning, tool-driven pipelines
  - **Strengths:** better step-by-step reliability than the instruct version
  - **Tradeoffs:** typically uses more tokens / slower per answer

### Vision-Language (VL)

- `vllm-qwen3-vl-32b-fp4` → served as **`qwen3-vl-32b-instruct-fp4`**
  - **Type:** vision-language, 32B, NVFP4
  - **Best for:** screenshots, PDFs-as-images, UI understanding, diagrams
  - **Strengths:** strong doc + screenshot reasoning
  - **Tradeoffs:** heavier than 7B VL models

- `vllm-qwen3-vl-30b-thinking` → served as **`qwen3-vl-30b-thinking-instruct`**
  - **Type:** vision-language "thinking" model, 30B
  - **Best for:** complex visual reasoning, step-by-step analysis of images
  - **Strengths:** enhanced reasoning capabilities over standard instruction model
  - **Tradeoffs:** slower inference due to thinking process

- `vllm-qwen25-vl-7b` → served as **`qwen2.5-vl-7b`**
  - **Type:** vision-language, 7B (4-bit AWQ)
  - **Best for:** low-cost image QA, simple screenshot reading
  - **Strengths:** cheap + fast VL
  - **Tradeoffs:** weaker at dense docs / complex visuals than 32B VL

### GLM family (text + vision)

- `vllm-glm-4.5-air-fp4` → served as **`glm-4.5-air-fp4`**
  - **Type:** general-purpose text, NVFP4
  - **Best for:** assistant workflows, long conversations, “agent-y” behavior
  - **Strengths:** pragmatic instruction-following
  - **Tradeoffs:** may vary in style vs GPT/Qwen

- `vllm-glm-4.6v-flash-fp4` → served as **`glm-4.6v-flash-fp4`**
  - **Type:** vision-language “flash” (low latency), NVFP4
  - **Best for:** real-time UI agents, fast screenshot interpretation
  - **Strengths:** very fast VL
  - **Tradeoffs:** not the top choice for deep reasoning

- `vllm-glm-4.5-air-derestricted-fp4` → served as **`glm-4.5-air-derestricted-fp4`**
  - **Type:** derestricted text model, NVFP4
  - **Best for:** internal testing, fewer refusals, creative/roleplay
  - **⚠️ Avoid for:** public/prod deployments without additional safety controls

- `vllm-glm4-9b` → served as **`glm-4-9b-chat`**
  - **Type:** small chat model (~9B)
  - **Best for:** cheap chat, lightweight assistants, simple Q&A
  - **Tradeoffs:** weaker reasoning + coding than 30B+ models

### Gemma 4

- `vllm-gemma4-26b-a4b` → served as **`gemma4-26b-a4b`**
  - **Type:** multimodal Gemma 4 MoE model (text + image) with native tool calling
  - **Best for:** experimental Gemma-family coding/chat, image Q&A, and agent-style tool use
  - **Strengths:** verified gateway-path image input and function calling on the current stack; large raw 256K context window
  - **Tradeoffs:** still experimental; current interactive guidance is `100000` prompt tokens, and explicit thinking mode can burn completion budget quickly

- `vllm-gemma4-31b` → served as **`gemma4-31b`**
  - **Type:** dense Gemma 4 multimodal model (text + image)
  - **Best for:** manual-only quality experiments with the larger Gemma family
  - **Tradeoffs:** currently too slow for interactive use on this host, so it is intentionally omitted from the shipped OpenCode config

### Coding specialists

- `vllm-qwen3-coder-30b` → served as **`qwen3-coder-30b-a3b-instruct`**
  - **Type:** coding MoE, NVFP4
  - **Best for:** long-context coding, refactors, codebase understanding
  - **Strengths:** excellent with large context + tool loops
  - **Tradeoffs:** sometimes less “polished” natural language than a general chat model

- `vllm-qwen25-coder-7b` → served as **`qwen2.5-coder-7b-instruct`**
  - **Type:** small coding model
  - **Best for:** quick scripts, autocomplete, low-cost coding help
  - **Tradeoffs:** struggles with complex multi-file refactors

### Reasoning specialists

- `vllm-deepseek-r1-14b` → served as **`deepseek-r1-distill-qwen-14b`**
  - **Type:** reasoning model (distilled)
  - **Best for:** reasoning on a budget, single-GPU workloads
  - **Tip:** often performs best at **temp ~0.6** for reasoning consistency

- `vllm-deepseek-r1-32b` → served as **`deepseek-r1-distill-qwen-32b`**
  - **Type:** larger reasoning model (distilled)
  - **Best for:** difficult reasoning + planning, better reliability than 14B
  - **Tradeoffs:** slower/heavier than 14B

- `vllm-phi-4-reasoning-plus-fp4` → served as **`phi-4-reasoning-plus-fp4`**
  - **Type:** reasoning-focused text model, NVFP4
  - **Best for:** careful multi-step analysis, complex logic, robust answers
  - **Tradeoffs:** may be slower / more verbose

- `vllm-nemotron-3-nano-30b-nvfp4` → served as **`nemotron-3-nano-30b-nvfp4`**
  - **Type:** efficient MoE reasoning model, NVFP4
  - **Best for:** production agent workloads, long prompts, fast reasoning at scale
  - **Strengths:** strong efficiency and throughput
  - **Tradeoffs:** still experimental on the current harness; visible answers depend on the non-thinking request shape now enforced by the validator

### Multilingual / EU

- `vllm-eurollm-22b-fp4` → served as **`eurollm-22b-instruct-fp4`**
  - **Type:** multilingual text model, NVFP4
  - **Best for:** EU languages, translation, multilingual RAG / customer support
  - **Strengths:** strong coverage across European languages
  - **Tradeoffs:** **Text Only** (No tool calling). **Not for OpenCode** (System prompt leakage).

### OCR

- `vllm-deepseek-ocr` → served as **`deepseek-ocr`**
  - **Type:** OCR (image → text)
  - **Best for:** extracting raw text from scans/screenshots
  - **Tradeoffs:** **Utility only**. Not designed for direct chat or OpenCode (use via API).
  - **Recommended pipeline:** OCR → send extracted text into a reasoning/chat model

### Audio (Disabled)

- `vllm-step-audio-r1-fp4` → served as **`step-audio-r1-fp4`** (Disabled)
  - **Type:** audio reasoning model, NVFP4 (custom vLLM container)
  - **Best for:** speech/audio understanding + reasoning tasks
  - **Tradeoffs:** not a general “best text model” (use alongside a text model)

### Small / utility

- `vllm-qwen3.5-0.8b` → served as **`qwen3.5-0.8b`**
  - **Type:** small Qwen 3.5 multimodal helper on the SGLang runtime
  - **Best for:** session titles, lightweight routing, tagging, and short classification tasks
  - **Strengths:** better headroom than the legacy tiny helper, utility-friendly always-on path, upstream checkpoint also supports image input and thinking mode
  - **Tradeoffs:** still utility-only in this repo; not promoted as a general OpenCode chat model, and the local path intentionally keeps a conservative memory/context envelope for coexistence

- `vllm-qwen2.5-1.5b` → served as **`qwen2.5-1.5b-instruct`**
  - **Type:** small instruction model, Qwen 2.5 (1.5B params)
  - **Best for:** fallback small-text tasks when you want the legacy vLLM helper path
  - **Tradeoffs:** still efficient, but it is no longer the shipped utility default and remains less capable than the newer Qwen 3.5 helper.

### Multimodal “one model for everything”

- `vllm-phi-4-multimodal-fp4` → served as **`phi-4-multimodal-instruct-fp4`**
  - **Type:** multimodal (text + image [+audio]), NVFP4
  - **Best for:** apps that need one endpoint for mixed inputs
  - **Strengths:** strong “general multimodal assistant”
  - **Tradeoffs:** may not beat best-in-class specialist models (VL-only or reasoning-only)

- `vllm-nemotron` → served as **`nemotron-nano-12b-v2-vl`**
  - **Type:** smaller vision-language model
  - **Best for:** lightweight vision assistants and image Q&A
  - **Tradeoffs:** weaker than Qwen3-VL-32B on dense documents
