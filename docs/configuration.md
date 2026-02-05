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
- `IDLE_STOP_SECONDS`: Idle time before stopping (default: 1800 = 30 min)
- `NO_STOP_BEFORE_SECONDS`: Minimum uptime before allowing stop (default: 30)
- `HEALTH_TIMEOUT_MS`: Max wait for health check (default: 1800000 = 30 min)
- `DOCKER_STOP_TIMEOUT_SECONDS`: Grace period for container stop (default: 5)
- `TICK_MS`: State check interval (default: 1000)
- `BUSY_STATUS_CODE`: HTTP code for busy responses (default: 403)
- `MODELS_JSON`: Model configuration mapping

### Model Configuration Features
- **GPU Memory Utilization**: Configurable allocation (default ~82%, small models ~5-12%)
- **Concurrent Sequences**: Configurable max sequences (3 for oss20b, 3 for qwen-math)
- **Custom Tokenizers**: Support for custom tiktoken encodings
- **Persistent Cache**: HuggingFace cache persisted to `./vllm_cache_huggingface`

## Network Configuration

The stack uses two Docker networks:

- `default`: External network for gateway access
- `vllm_internal`: Internal network (isolated) for model communication
