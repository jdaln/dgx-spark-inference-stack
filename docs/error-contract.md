# Error Contract

The gateway and waker return OpenAI-compatible error envelopes for client-facing failures:

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

| Code | HTTP | Meaning |
|---|---:|---|
| `invalid_json` | 400 | Request body was not valid JSON. |
| `missing_model` | 400 | Request body did not include `model`. |
| `model_not_found` | 404 | The requested model is not configured or its container was not created. |
| `model_busy` | 429 | Another managed LLM container is already running. |
| `external_gpu_busy` | 429 | An external GPU workload, such as ComfyUI, is running and policy is `block`. |
| `model_health_timeout` | 503 | The model container did not report healthy before timeout. |
| `waker_timeout` | 504 | The validator could not reach the waker in time. |
| `waker_invalid_response` | 502 | The waker returned invalid JSON. |
| `upstream_unavailable` | 502 | The validator could not connect to the selected model service. |
| `internal_error` | 500 | An internal gateway or waker error occurred. |

Busy responses include short headers when available:

```text
Retry-After: 30
X-DGX-Busy-Container: vllm-...
X-DGX-Busy-Workload: comfyui
X-DGX-External-GPU-Policy: block
```

Long diagnostics are kept in `/debug/state` and service logs, not in the client-facing error body.
