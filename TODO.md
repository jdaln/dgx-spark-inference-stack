# TODOs


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
https://huggingface.co/Firworks/GLM-4.6V-Flash-nvfp4
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