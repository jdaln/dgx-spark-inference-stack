# Configuration

## Current Operating Defaults

- **Conservative defaults:** `gpt-oss-20b`, `gpt-oss-120b`, and `glm-4.7-flash-awq`
- **Utility helper:** `qwen3.5-0.8b`
- **Current OSS SOTA opt-in families:** use `qwen3.6-35b-a3b-fp8-mtp` or `qwen3.6-35b-a3b-fp8` for long-context text/tool work, and `gemma4-26b-a4b` for multimodal / tool-capable work in its size class

Promote an experimental lane to your own daily default only after a real gateway-path soak on this host, not just a single healthy startup.

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
- `IGNORE_NAMES`: Comma-separated container names to never manage (default in this repo: `vllm-gateway,vllm-waker,vllm-request-validator`)
- `IDLE_STOP_SECONDS`: Idle time before stopping a model (default: 0 = disabled; set to 1200 = 20 min in docker-compose.yml)
- `NO_STOP_BEFORE_SECONDS`: Minimum uptime before allowing stop (default: 30)
- `HEALTH_TIMEOUT_MS`: Max wait for health check on the waker `/ensure` path (default: 900000 = 15 min)
- `DOCKER_STOP_TIMEOUT_SECONDS`: Grace period for container stop (default: 5)
- `TICK_MS`: State check interval (default: 1000)
- `STOP_DEBOUNCE_MS`: Debounce delay before stopping idle containers (default: 20000 = 20 sec)
- `BUSY_STATUS_CODE`: HTTP code for busy responses (code default: 409; set to 429 in docker-compose.yml)
- `MODEL_HEALTH_URL_TEMPLATE`: Health URL template with `{name}` placeholder (default in this repo: `http://{name}:8000/health`)

Model inventory is no longer configured via `MODELS_JSON`, `UTILITY_CONTAINER`, or `EXCLUSIVE_CONTAINERS` environment variables. Those are now derived from `models.json`, and the current utility container is auto-ignored by waker from that same shared inventory.

After changing `models.json`, run `bash tools/reload-control-plane.sh` so `waker` and `request-validator` reload the mounted config. If you also changed which model is the utility helper, `bash tools/reload-control-plane.sh --stop-stale-utility` will stop the old helper container after the reload.

For long first cold starts, also keep these distinctions in mind:

- The per-model Docker healthcheck `start_period` is configured in the compose fragment for that model service, not in the waker service
- `tools/run-model.sh` waits on the model container's Docker healthcheck, so increasing `HEALTH_TIMEOUT_MS` alone will not help a manual recreate run
- Waker idle-stop now treats a model that has never become healthy as still starting, even if Docker health has already flipped from `starting` to `unhealthy`

### Model Configuration Features
- **GPU Memory Utilization**: Configurable allocation (default ~82%, small models ~5-12%)
- **Concurrent Sequences**: Tuned per service rather than one global default
- **Custom Tokenizers**: Support for custom tiktoken encodings
- **Persistent Cache**: HuggingFace cache persisted to `./vllm_cache_huggingface`
- **Official recipe mirrors**: The Qwen 3.6 lanes keep the upstream Spark Arena FP8 / MTP recipe shape as closely as practical while still fitting this repo's control-plane behavior

## Operational Entry Points

Use these repo-level tools instead of one-off shell snippets when you are modifying or validating the stack:

- `bash tools/validate-stack.sh` after structural changes to compose fragments or `models.json`
- `bash tools/reload-control-plane.sh` after inventory or lifecycle changes that only affect `waker` or `request-validator`
- `bash tools/run-model.sh --no-build <model-id>` for controlled manual bring-up under the current scheduler rules
- `bash tools/smoke-gateway.sh` for the standard gateway-path smoke matrix
- `node tools/soak-context.mjs ...` to establish a real prompt ceiling on this host before promoting an experimental lane such as Qwen 3.6

## Network Configuration

The stack uses two Docker networks:

- `default`: External network for gateway access
- `vllm_internal`: Internal network (isolated) for model communication
