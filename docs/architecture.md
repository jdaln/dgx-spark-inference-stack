# Architecture

The stack consists of four main components:

1. **vLLM Model Containers** (profiles: `models`), each runs vLLM with an OpenAI-compatible API.

2. **Waker Service** (always running)
   - Node.js service that manages model container lifecycle.
   - Implements single-tenant scheduling (one model at a time).
   - Handles health checks and automatic startup/shutdown.
   - **Priority Scheduling**: Configured "Exclusive" models (e.g., 120B) can automatically stop the "Small/Utility" model (Qwen 1.5B) to free up resources in order to fit.
   - Provides debug endpoints for monitoring.

3. **Request Validator** (always running)
   - Node.js middleware that validates and fixes API requests.
   - Automatically removes negative or invalid `max_tokens` values.
   - Prevents `400 Bad Request` errors from clients with mismatched context window settings.

4. **API Gateway** (always running)
   - Nginx reverse proxy on port 8009.
   - Routes requests to appropriate models (via validator for default route).
   - Returns HTTP 403 when busy/starting with `Retry-After` header.

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
├── waker/                      # Waker service
│   ├── Dockerfile
│   ├── index.js                # Main waker logic
│   ├── package.json
│   └── package-lock.json
├── models/                     # Model download cache (created at runtime)
├── vllm_cache_huggingface/     # HuggingFace cache (created at runtime)
├── manual_download/            # Custom tokenizers and files
└── .gitignore
```

## How It Works

### Request Flow

1. Client sends request to `http://localhost:8009/v1/qwen-math/...`
2. Nginx performs auth subrequest to waker: `POST /ensure/qwen-math`
3. Waker checks:
   - Is another model running? → Return 403 with detailed info
   - Is qwen-math already running? → Check health
   - Otherwise → Start container and wait for health
4. If healthy: Waker returns 200, Nginx proxies to model
5. If busy/starting: Nginx returns 403 with detailed model status and timing info

### Lifecycle Management

1. **Startup**: Container starts when first requested
2. **Active**: Waker tracks last activity timestamp
3. **Idle Detection**: After 5 min idle + 30 sec minimum uptime
4. **Shutdown**: Container stops gracefully (5 sec timeout)
5. **Cooldown**: 20 sec debounce prevents rapid restart cycles

### Health Checking

- vLLM models expose `/health` endpoint
- Waker polls health endpoint every second
- Initial health check waits up to 15 minutes
- Gateway depends on waker health before accepting requests
