# Configuration

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VLLM_API_KEY` | API Key for model access | `63TestTOKEN0REPLACEME` |
| `VLLM_LOGGING` | Enable vLLM internal logging (0/1) | `0` |
| `WAKER_VERBOSE` | Enable waker service logging (0/1) | `0` |
| `DOCKER_LOG_DRIVER` | Docker logging driver | `json-file` |

To set these variables, you can create a `.env` file in the project root:
```env
VLLM_API_KEY=your_secure_api_key_here
VLLM_LOGGING=0
WAKER_VERBOSE=0
```

### Waker Configuration
Located in `docker-compose.yml` under the `waker` service:

- `PORT`: Waker HTTP port (default: 18080)
- `MANAGE_PREFIX`: Container name prefix to manage (default: "vllm-")
- `IGNORE_NAMES`: Comma-separated container names to never manage (default: "vllm-gateway,vllm-waker,vllm-request-validator")
- `IDLE_STOP_SECONDS`: Idle time before stopping a model (default: 0 = disabled; set to 1200 = 20 min in docker-compose.yml)
- `NO_STOP_BEFORE_SECONDS`: Minimum uptime before allowing stop (default: 30)
- `HEALTH_TIMEOUT_MS`: Max wait for health check (default: 900000 = 15 min)
- `DOCKER_STOP_TIMEOUT_SECONDS`: Grace period for container stop (default: 5)
- `TICK_MS`: State check interval (default: 1000)
- `STOP_DEBOUNCE_MS`: Debounce delay before stopping idle containers (default: 20000 = 20 sec)
- `BUSY_STATUS_CODE`: HTTP code for busy responses (code default: 409; set to 429 in docker-compose.yml)
- `UTILITY_CONTAINER`: Always-running small model container name (default: "vllm-qwen2.5-1.5b")
- `EXCLUSIVE_CONTAINERS`: Comma-separated containers that require stopping the utility model to free GPU memory (default: "vllm-oss120b")
- `MODEL_HEALTH_URL_TEMPLATE`: Health URL template with `{name}` placeholder (default: "http://{name}:8001/health")
- `MODELS_JSON`: Model configuration mapping (model name → container/upstream/health)

### Model Configuration Features
- **GPU Memory Utilization**: Configurable allocation (default ~82%, small models ~5-12%)
- **Concurrent Sequences**: Configurable max sequences (3 for oss20b, 3 for qwen-math)
- **Custom Tokenizers**: Support for custom tiktoken encodings
- **Persistent Cache**: HuggingFace cache persisted to `./vllm_cache_huggingface`

## Network Configuration

The stack uses two Docker networks:

- `default`: External network for gateway access
- `vllm_internal`: Internal network (isolated) for model communication
