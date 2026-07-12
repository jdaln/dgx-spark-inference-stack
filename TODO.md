# TODOs

## gemma4 lanes: empty (`<pad>`) answers for complex tasks at ~240k context in non-thinking mode

**Symptom (found 2026-07-12):** `node tools/soak-context.mjs --model gemma4-26b-a4b --target-prompt-tokens 240000 --concurrency 5` returns HTTP 200 for all requests, but every response is 1024 `<pad>` tokens (`finish_reason: "length"`, `contentLength: 0`). Also reproduces solo (`--concurrency 1`). Regression vs the April validation recorded in `models.json`.

**Investigation results (2026-07-12):**
- There were **two stacked problems**. The first is fixed:
  1. **Prefix-cache poisoning (FIXED):** with `--enable-prefix-caching` + fp8 KV cache, a failing long-context soak corrupted reused KV blocks — afterwards even 32k requests padded out until container restart (exact-prefix cache hits padded; one-token-perturbed cache misses were clean). Removed `--enable-prefix-caching` from all three gemma lanes in `compose/models-gemma.yml` (26b validated live; e2b/31b changed without testing). With the flag gone, a failing soak no longer poisons subsequent requests.
  2. **Long-context capability collapse (OPEN):** even without prefix caching, the 240k soak still pads out. Isolation matrix (all at ~243k prompt tokens, temperature 0):
     - unique random text + trivial task ("reply FULL OK"), non-thinking scaffold → **clean**
     - soak prompt (repetitive stack-docs bundle) + complex analytical task, non-thinking scaffold → **pads**
     - identical soak prompt with `chat_template_kwargs: {"enable_thinking": true}` → **clean, coherent analysis**
     - identical soak prompt at 32k → clean.
- **Non-thinking knee (measured 2026-07-12):** same complex soak prompt, non-thinking: 64k clean, 128k clean, **192k pads**. So the collapse sets in between ~130k and ~195k prompt tokens.
- The pre-closed empty thought scaffold (`<|channel>thought\n<channel|>`) is identical in the stock and custom templates, so this is not a template regression; the custom template (added in bbe1968, June 3) renders byte-identical generation prompts here.
- Suspect: numerical degradation at extreme context with fp8 attention — vLLM warns at startup: "Using uncalibrated q_scale 1.0 and/or prob_scale 1.0 with fp8 attention. This may cause accuracy issues." Forcing a direct answer (no thinking) on a hard task at 240k collapses to `<pad>`; letting the model think first re-anchors it.

**Options for the open problem:**
1. Treat long-context complex tasks as thinking-required on this lane: clients pass `chat_template_kwargs: {"enable_thinking": true}` (with a bigger `max_tokens` budget); document the non-thinking ceiling of ~128k (measured; bisect 128k–192k for the exact knee if needed). Update `models.json` notes accordingly. `tools/soak-context.mjs` now supports `--enable-thinking` to validate this mode.
2. Test `--kv-cache-dtype auto` (and/or non-fp8 attention) to see whether precision restores non-thinking answers at 240k. Costs KV capacity — likely halves the concurrent long-context envelope.
3. Try providing calibrated k/v/q scales (requantized checkpoint) or a newer vLLM in the `vllm-node-tf5-gemma4` overlay — larger effort, upstream may have fixed fp8-attention scaling.

**Remaining follow-ups:**
- Re-run `node tools/soak-context.mjs --model gemma4-26b-a4b --target-prompt-tokens 240000 --concurrency 5 --enable-thinking` (with `--max-tokens` raised, e.g. 2048, since thinking consumes budget) to confirm the thinking path passes the original soak.
- Soak-tool improvement ideas: fail fast with an explicit "all-pad/empty content" verdict instead of just `meetsContentFloor: false`; optionally run a post-soak small-context probe to detect lane poisoning; support a per-request unique filler salt to separate cache-hit vs cache-miss behavior.
- Update `models.json` gemma4-26b-a4b notes (currently claim 243k×5 pass; reality: non-thinking ceiling ~128k, thinking mode OK at 243k solo — concurrency 5 with thinking not yet validated).

---

## Gateway auth layering: invalid bearer tokens can enumerate model IDs

The gateway only checks that an `Authorization` header is present; the actual API key is verified by the vLLM container. A request with a wrong token (`Authorization: Bearer wrong`) still reaches the request-validator and receives `model_not_found` vs routing, letting an unauthenticated caller probe which model IDs are configured. Consider validating the token at the gateway or validator before any model lookup.

---

### Test Ollama Integration (OpenAI API Compatibility)

Investigate running an [Ollama](https://ollama.com/) server as a potential alternative backend or "sidecar" alongside vLLM. Ollama provides native OpenAI API compatibility, which could simplify deploying GGUF quantized models or running models on different hardware backends.

**Goal:** Verify that the stack's `request-validator` and `gateway` can successfully route requests to an Ollama instance.

**Example Configuration to Test:**

Add an `ollama` service to `docker-compose.yml`:
```yaml
  ollama:
    image: ollama/ollama:latest
    container_name: ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama_models:/root/.ollama
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    networks:
      - vllm_internal
```

**Testing Steps:**
1. Start the Ollama service.
2. Pull a model: `docker exec -it ollama ollama run llama3`
3. Test the OpenAI-compatible endpoint:
   ```bash
   curl http://localhost:11434/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{
       "model": "llama3",
       "messages": [{"role": "user", "content": "Hello!"}]
     }'
   ```
4. If successful, add an entry to the waker's `MODELS_JSON` pointing to `http://ollama:11434` (upstream).

---
## Determine models that can run in parallel

At the moment, we limit to 1 model + 1 utility one but in the future, it would be great to have a more dynamic way of runnning things. This is why we have this `stats/` directory to collect stats on actual GPU usage.

--
## Integrate more niche models - to check if useful and functional

Possible general models:
https://huggingface.co/HuggingFaceTB
https://huggingface.co/Firworks/SERA-32B-GA-nvfp4
https://huggingface.co/Firworks/SERA-32B-nvfp4

Possible replacements for  tiny utility models:
https://huggingface.co/Firworks/LFM2.5-1.2B-Instruct-nvfp4
https://huggingface.co/Firworks/LFM2.5-1.2B-Base-nvfp4

Possible Models marked for languages :
https://huggingface.co/kaitchup/translategemma-12b-it-NVFP4
https://huggingface.co/Firworks/Apertus-8B-Instruct-2509-Heretic-nvfp4
https://huggingface.co/Firworks/Apertus-8B-Instruct-2509-nvfp4
https://huggingface.co/Firworks/LFM2.5-1.2B-JP-nvfp4
https://huggingface.co/Firworks/shisa-v2.1-llama3.3-70b-nvfp4
https://huggingface.co/Firworks/shisa-v2.1-unphi4-14b-nvfp4
https://huggingface.co/Firworks/shisa-v2.1-lfm2-1.2b-nvfp4
https://huggingface.co/shisa-ai
https://huggingface.co/swiss-ai/Apertus-70B-Instruct-2509
https://huggingface.co/LumiOpen/Llama-Poro-2-70B-Instruct
https://huggingface.co/LumiOpen/Llama-Poro-2-70B-base
https://huggingface.co/LumiOpen/Llama-Poro-2-70B-SFT

Possible Models marked for image generation:
https://huggingface.co/Qwen/Qwen-Image-2512

Possible Models marked for RP:
https://huggingface.co/Firworks/Behemoth-X-123B-v2.1-nvfp4
https://huggingface.co/Firworks/Precog-123B-v1-nvfp4
https://huggingface.co/Firworks/Precog-24B-v1-nvfp4
https://huggingface.co/jiangchengchengNLP/Llama-4-Scout-17B-16E-Instruct-abliterated-v2-nvfp4
https://huggingface.co/johnnyeric/DeepSeek-R1-0528-Qwen3-8B-abliterated-nvfp4
https://huggingface.co/Shifusen/Llama-3.3-70B-Instruct-abliterated-NVFP4-modelopt
https://huggingface.co/mratsim/Behemoth-X-123B-v2-NVFP4
https://huggingface.co/mratsim/Monstral-123B-v2-NVFP4
https://huggingface.co/mratsim/L3.3-Ignition-v0.1-70B-NVFP4
https://huggingface.co/mratsim/Strawberrylemonade-L3-70B-v1.1-NVFP4
https://huggingface.co/mratsim/70B-L3.3-Cirrus-x1-NVFP4
https://huggingface.co/collections/mratsim/2025-text-adventure-rp-and-creative-writing-glm-45-air
https://huggingface.co/mratsim/Dungeonmaster-V2.2-Expanded-LLaMa-70B-NVFP4
https://huggingface.co/lyf/Qwen3.5-27B-Uncensored-HauhauCS-Aggressive-NVFP4
https://huggingface.co/Firworks/Void-Citrus-L3.3-70B-mxfp4
https://huggingface.co/Firworks/L3-Darkest-Planet-16B-HERETIC-Uncensored-Abliterated-nvfp4
https://huggingface.co/Firworks/L3-DARKEST-PLANET-16.5B-nvfp4
https://huggingface.co/Firworks/Cassiopeia-70B-fp8

Possible science models:
https://huggingface.co/Firworks/Chemistry-R1-nvfp4