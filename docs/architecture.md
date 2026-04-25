# Architecture

The stack consists of four main components:

1. **vLLM Model Containers** (profiles: `models`), each runs vLLM with an OpenAI-compatible API.

2. **Waker Service** (always running)
   - Node.js service that manages model container lifecycle.
   - Enforces one active main-model lane while ignoring the configured utility helper for busy checks.
   - Handles health checks and automatic startup/shutdown.
   - **Priority Scheduling**: Configured "Exclusive" models can automatically stop the utility helper to free up resources when needed.
   - Provides debug endpoints for monitoring.

3. **Request Validator** (always running)
   - Node.js middleware that validates and fixes API requests.
   - Automatically removes negative or invalid `max_tokens` values.
   - Prevents `400 Bad Request` errors from clients with mismatched context window settings.

4. **API Gateway** (always running)
   - Nginx reverse proxy on port 8009.
   - Routes all `/v1/` traffic through the request validator.
   - Returns HTTP 429 when busy/starting with `Retry-After` header.

### API Endpoints

#### Gateway (port 8009)
- `GET /healthz` - Gateway health check
- `GET /debug/*` - Proxies to waker debug endpoints
- `POST /v1/*` - For queries

#### Waker (internal port 18080)
- `GET /healthz` - Waker health check
- `GET /debug/state` - Current state and configuration
- `POST /ensure/<model>` - Ensure a model is running and healthy
- `POST /touch/<model>` - Update last-seen timestamp (prevent idle shutdown)

## Project Structure

```
.
├── docker-compose.yml          # Main orchestration file
├── gateway.conf                # Nginx configuration
├── compose/                    # Model compose files (models-gpt.yml, models-qwen.yml, etc.)
├── waker/                      # Waker service (lifecycle manager)
│   ├── Dockerfile
│   ├── index.js                # Main waker logic
│   ├── gpu-monitor.js          # GPU stats tracking
│   └── package.json
├── request-validator/          # Request validation/routing middleware
│   ├── Dockerfile
│   ├── index.js                # Validation, token capping, model routing
│   └── package.json
├── custom-docker-containers/   # Custom vLLM image build contexts
├── tools/                      # Supported validation harness, probes, and workarounds
│   ├── README.md
│   ├── run-model.sh
│   ├── smoke-gateway.sh
│   ├── soak-context.mjs
│   ├── test-model.py
│   ├── streaming-proxy/
│   └── legacy/
├── docs/                       # Documentation
├── models/                     # Model download cache (created at runtime)
├── vllm_cache_huggingface/     # HuggingFace cache (created at runtime)
├── manual_download/            # Custom tokenizers and files
└── .gitignore
```

## How It Works

### Request Flow

1. Client sends request to `http://localhost:8009/v1/chat/completions` with `"model": "qwen-math"`
2. Nginx proxies all `/v1/` traffic to the **request validator** (port 18081)
3. Request validator reads the `model` field from the request body, then calls the **waker**: `POST /ensure/qwen-math`
4. Waker checks:
   - Is another managed main-model container already running? → Return 429 with detailed info
   - If the requested model is `lifecycle: "exclusive"` and the utility helper is running, stop the utility helper first
   - Is qwen-math already running? → Check health
   - Otherwise → Start container and wait for health
5. If healthy: Waker returns 200, request validator fixes/validates the request (token capping, role alternation, tool stripping), then proxies to the vLLM container
6. If busy/starting: Request validator forwards the 429 response with model status and `Retry-After` header back to the client

### Lifecycle Management

1. **Startup**: Container starts when first requested
2. **Active**: Waker tracks last activity timestamp
3. **Idle Detection**: After 20 min idle (configurable via `IDLE_STOP_SECONDS`) + 30 sec minimum uptime
4. **Shutdown**: Container stops gracefully (5 sec timeout)
5. **Cooldown**: 20 sec debounce prevents rapid restart cycles

### Health Checking

- vLLM models expose `/health` endpoint
- Waker polls health endpoint every second
- Initial health check waits up to 15 minutes
- Gateway depends on waker health before accepting requests
