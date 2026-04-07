# TODOs

## Make `tools/run-model.sh` Cold-Start Aware

The current runner still treats Docker `health=unhealthy` as a hard failure even when a first cold start is obviously still making real progress through image pull, model download, or initial load.

**Goal:** make first-run bring-up of new recipe-wave models observable and reliable without masking genuine startup failures.

**Why now:** the post-Step-4 recipe-expansion wave is active, and the plan already calls out this exact gap from the Gemma TF5 bring-up path.

**Done when:** `tools/run-model.sh` can distinguish expected cold-start progress from a real stall, surfaces the active phase clearly, and still fails fast once progress actually stops.

## Keep External Recipe Provenance Explicit

When the repo adopts a model config from a non-primary upstream source, record that provenance in the shipped docs and credits instead of leaving it only in `my-plan-for-improvments.md` or commit history.

**Goal:** make external recipe lineage visible and reviewable before those models become recommended defaults or shipped helpers.

**Next case already in flight:** Patrick Yi / scitrera.ai's `Qwen/Qwen3.5-0.8B` SGLang utility recipe.

**Done when:** adopted external recipes have a visible repo-level breadcrumb in the relevant docs or credits, plus a lightweight `sourceRecipe` pointer in `models.json`.


## Test Ollama Integration (OpenAI API Compatibility)

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