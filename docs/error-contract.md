# Error contract

The gateway, request validator and waker all return OpenAI-compatible error envelopes:

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

All four fields are always present. `param` and `code` may be `null`.

## Codes

| Code | HTTP | From | Meaning |
|---|---:|---|---|
| `invalid_api_key` | 401 | validator | Missing or wrong bearer token. Checked before any model is woken. |
| `invalid_json` | 400 | validator | Body was not valid JSON. |
| `bad_request` | 400 | gateway | nginx rejected the request line or headers (malformed, or headers too large). |
| `uri_too_long` | 414 | gateway | Request URI too long for nginx. |
| `missing_model` | 400 | validator, waker | Body had no `model`. |
| `request_too_large` | 413 | gateway, validator | Body exceeds the size limit (64 MB default). |
| `unsupported_parameter` | 400 | validator | The lane runs speculative decoding and the request sets `min_p` above 0 or a non-empty `logit_bias`, which the engine would ignore. Checked before any model is woken. |
| `model_not_found` | 404 | validator, waker | Model is not configured, or its container was never created. Also returned as 400 by `/touch` for unmanaged names. |
| `forbidden` | 403 | gateway | Method not allowed on that route (non-GET on `/debug/*`). |
| `host_not_allowed` | 403 | gateway | `Host` is not `localhost`, `127.0.0.1` or `host.docker.internal`. |
| `route_not_found` | 404 | gateway, waker | Path matches no known route. |
| `stats_not_found` | 404 | waker | No GPU stats recorded for that container. |
| `model_busy` | 429 | waker | Another managed LLM container is running. |
| `external_gpu_busy` | 429 | waker | An external GPU workload is running and policy is `block`. |
| `model_start_failed` | 502 | waker | The container exited before reporting healthy. The message carries up to 60 lines / 8 KB of container log tail. |
| `waker_invalid_response` | 502 | validator | The waker returned invalid JSON. |
| `upstream_unavailable` | 502 | gateway, validator | Could not connect to the upstream service. |
| `model_health_timeout` | 503 | waker | The container did not report healthy in time. |
| `model_weights_missing` | 503 | waker | The lane's weights are not in `./models`. The message names the missing `repo@revision` and the `tools/download-weights.sh` command. Checked before the busy checks and before anything is started or stopped. |
| `docker_unavailable` | 503 | waker | The Docker API was unreachable. The waker fails closed rather than guessing GPU state. Retry shortly. |
| `service_unavailable` | 503 | gateway | nginx-generated 503. |
| `waker_timeout` | 504 | validator | The validator could not reach the waker in time. |
| `gateway_timeout` | 504 | gateway | `proxy_read_timeout` fired before the upstream answered. |
| `waker_error` | varies | validator | The waker returned a non-envelope error body; the validator wrapped it. |
| `upstream_error` | engine's | validator | The model engine failed the request. Its message is kept, `type` follows the HTTP status, and a string `code` from the engine replaces this one. |
| `internal_error` | 500 | all | Internal error in the gateway, validator or waker. |

## Busy headers

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

Long diagnostics stay in `/debug/state` and the service logs. The exception is
`model_start_failed`, which carries the log tail so a client can see why the start failed.

`POST /check/<model>` returns 202 with `{"status":"initializing"}` while a start is in
progress. If a background start fails, the next poll returns the stored failure envelope
for `ENSURE_ERROR_TTL_MS` (30 s) instead of restarting the container.
