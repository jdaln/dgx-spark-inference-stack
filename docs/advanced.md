# Advanced Usage

## Adding a New Model

1. Add model service to `docker-compose.yml`:
```yaml
vllm-my-model:
  image: nvcr.io/nvidia/vllm:25.10-py3 #although this NVIDIA one does not work the best, consider others
  container_name: vllm-my-model
  profiles: ["models"]
  command:
    - vllm
    - serve
    - org/model-name
    - --host
    - 0.0.0.0
    - --port
    - "8000"
    - --gpu-memory-utilization
    - "0.82"
  # ... (copy from existing model config)
  networks:
    - vllm_internal
```

2. Add route to `gateway.conf`:
```nginx
location ~ ^/v1/my-model/(.*)$ {
  auth_request /__ensure/my-model;
  error_page 401 403 = @busy_mymodel;
  proxy_set_header Authorization $auth_header;
  proxy_pass http://vllm-my-model:8000/v1/$1;
}
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
