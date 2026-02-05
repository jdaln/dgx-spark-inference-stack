# TODOs

## Secure Docker Socket (Waker Service)

Currently, the `waker` service has full root access to the host via `/var/run/docker.sock`. This can become a security risk.
**Goal:** Restrict `waker`'s access to only necessary Docker API operations (list, inspect, start, stop).

**Proposed Solution:**
Run a proxy container between `waker` and the docker socket.
`tecnativa/docker-socket-proxy` is an example implementation, but:
> [!WARNING]
> This proxy image itself is a potential entry point and must be audited and brought under control. Do not blindly trust third-party images for security-critical components. Ensure you understand its configuration and consider build it from source heres.

**Possible implemntation plan:**
1.  Add `docker-access-proxy` service to `docker-compose.yml`:
    ```yaml
    docker-access-proxy:
      image: tecnativa/docker-socket-proxy
      volumes:
        - /var/run/docker.sock:/var/run/docker.sock:ro
      environment:
        CONTAINERS: 1
        POST: 1 # Required for start/stop
      networks:
        - vllm_internal
    ```
2.  Update `waker` in `docker-compose.yml`:
    -   Remove `/var/run/docker.sock` volume.
    -   Set `DOCKER_HOST=tcp://docker-access-proxy:2375`.

---

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

## Make Mistral-based and Deepseek Models (vLLM) work

Try to run the Mistral based models with something like this.
```yaml
    profiles: ["models"]
    image: avarok/vllm-dgx-spark:v11-tf5
    container_name: vllm-MODEL_HERE
    command:
      - serve
      - --model
      - MODEL_HERE
      - --host
      - 0.0.0.0
      - --port
      - "8000"
      - --download-dir
      - /models
      - --served-model-name
      - MODEL_NAME_HERE
      - --enable-auto-tool-choice
      - --tool-call-parser
      - llama3_json
      - --gpu-memory-utilization
      - "0.82"
      - --dtype
      - auto
      - --max-model-len
      - "131072"
      - --quantization
      - compressed-tensors
      - --kv-cache-dtype
      - fp8
      - --trust-remote-code
      - --hf-overrides
      - '{"architectures": ["LlamaForCausalLM"], "model_type": "llama"}'
      - --disable-log-requests
      - --disable-log-stats
    volumes:
      - ./vllm_cache_huggingface:/root/.cache/huggingface
      - ./models:/models
      - ./flashinfer_cache:/root/.cache/flashinfer
      - ./torch_extensions:/root/.cache/torch_extensions
      - ./torchinductor:/tmp/torchinductor_root
    environment:
      HF_HOME: /root/.cache/huggingface
      VLLM_API_KEY: ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}
      VLLM_NO_USAGE_STATS: "1"
      VLLM_FLASHINFER_MOE_BACKEND: "latency"
      VLLM_USE_V1: "0"
      VLLM_CONFIGURE_LOGGING: ${VLLM_LOGGING:-0}
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: "all"
              capabilities: ["gpu"]
    shm_size: "16g"
    ulimits:
      memlock: -1
      stack: 67108864
    restart: "no"
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:8000/health || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 1800s
    logging:
      driver: ${DOCKER_LOG_DRIVER:-json-file}
      options:
        max-size: "10m"
        max-file: "3"
    networks:
      - default
      - vllm_internal
```

## Determine models that can run in parallel

At the moment, we limit to 1 model + 1 utility one but in the future, it would be great to have a more dynamic way of runnning things. This is why we have this `stats/` directory to collect stats on actual GPU usage.