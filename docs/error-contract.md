# Error Contract

The gateway (nginx), request-validator, and waker all return OpenAI-compatible error envelopes for client-facing failures:

```json
{
  "error": {
    "message": "Human-readable message.",
    "type": "invalid_request_error",
    "param": "model",
    "code": "model_not_found"
  }
}
```

`message`, `type`, `param`, and `code` are always present. `param` and `code` may be `null`.

## Common Codes

| Code | HTTP | Emitted by | Meaning |
|---|---:|---|---|
| `invalid_json` | 400 | validator | Request body was not valid JSON. |
| `missing_model` | 400 | validator, waker | Request body did not include `model`. |
| `request_too_large` | 413 | gateway, validator | Request body exceeds the size limit (64 MB by default). |
| `model_not_found` | 404 | validator, waker | The requested model is not configured or its container was not created. Also returned with HTTP 400 by the waker `/touch` endpoint for unmanaged names. |
| `route_not_found` | 404 | gateway, waker | The request path does not match any known route. |
| `stats_not_found` | 404 | waker | No GPU stats recorded for the requested container. |
| `model_busy` | 429 | waker | Another managed LLM container is already running. |
| `external_gpu_busy` | 429 | waker | An external GPU workload, such as ComfyUI, is running and policy is `block`. |
| `model_start_failed` | 502 | waker | The container exited before reporting healthy. The message embeds a bounded tail of the container logs (≤60 lines / ~8 KB) for diagnosis. |
| `model_health_timeout` | 503 | waker | The model container did not report healthy before timeout. |
| `docker_unavailable` | 503 | waker | The Docker API could not be reached; the waker fails closed rather than guessing GPU state. Retry shortly. |
| `service_unavailable` | 503 | gateway | nginx-generated 503. |
| `waker_timeout` | 504 | validator | The validator could not reach the waker in time. |
| `gateway_timeout` | 504 | gateway | nginx proxy timeout (`proxy_read_timeout`) fired before the upstream answered. |
| `waker_invalid_response` | 502 | validator | The waker returned invalid JSON. |
| `waker_error` | varies | validator | The waker returned a non-envelope error body; the validator wrapped it. |
| `upstream_unavailable` | 502 | gateway, validator | The gateway/validator could not connect to the upstream service. |
| `internal_error` | 500 | all | An internal gateway, validator, or waker error occurred. |

Busy responses include short headers when available:

```text
Retry-After: 30
X-DGX-Busy-Container: vllm-...
X-DGX-Busy-Model: gpt-oss-20b
X-DGX-Busy-Workload: comfyui
X-DGX-External-GPU-Policy: block
X-Model-Uptime-Sec: 245
X-Model-Idle-Sec: 120
X-Time-Until-Release-Sec: 180
X-Model-Will-Auto-Stop: true
```

Long diagnostics are kept in `/debug/state` and service logs; the one exception is `model_start_failed`, whose message carries a bounded container-log tail so clients can see why a start crashed.

Polling `POST /check/<model>` returns `202` with `{"status":"initializing"}` while a start is in progress. If a background start fails, the next poll returns the stored failure envelope (for `ENSURE_ERROR_TTL_MS`, default 30 s) instead of silently restarting the container.
