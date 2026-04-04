# Advanced Usage

## Adding a New Model

1. Add model service to a compose file in `compose/` (e.g., `compose/models-custom.yml`):
```yaml
services:
  vllm-my-model:
    profiles: ["models"]
    image: avarok/vllm-dgx-spark:v11
    container_name: vllm-my-model
    command:
      - vllm
      - serve
      - --model
      - org/model-name
      - --host
      - 0.0.0.0
      - --port
      - "8000"
      - --download-dir
      - /models
      - --served-model-name
      - my-model
      - --gpu-memory-utilization
      - "0.82"
      # ... (copy remaining flags from an existing model config)
    # ... (copy volumes, environment, deploy, healthcheck from existing model)
    networks:
      - default
      - vllm_internal
```

2. Include the compose file in `docker-compose.yml`:
```yaml
include:
  - compose/models-custom.yml
```

3. Add to waker `MODELS_JSON` (in `docker-compose.yml` environment variables):
```json
{
  "my-model": {
    "container": "vllm-my-model",
    "upstream": "http://vllm-my-model:8000",
    "health": "http://vllm-my-model:8000/health"
  }
}
```

4. Add to request-validator's `MODEL_CONFIG` (in `request-validator/index.js`):
```js
"my-model": { host: "vllm-my-model", port: 8000, maxModelLen: 131072 },
```

No changes to `gateway.conf` are needed — all `/v1/` traffic is automatically routed through the request validator, which handles model routing based on the request body.

## Disabling Single-Tenant Mode

To allow multiple models simultaneously:
- Remove the busy check logic in `waker/index.js` (`getRunningManagedExcept`)
- Ensure sufficient GPU memory for multiple models
- Adjust `--gpu-memory-utilization` accordingly

## Persistent Model Keep-Alive

Create a cron job to touch the model:
```bash
*/4 * * * * curl -X POST http://localhost:8009/debug/touch/vllm-qwen-math
```
