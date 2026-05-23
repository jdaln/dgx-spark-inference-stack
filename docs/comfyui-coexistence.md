# ComfyUI Coexistence

This stack can detect ComfyUI as an external GPU workload while keeping ComfyUI as a separate Compose project. ComfyUI is not a `models.json` entry and its traffic does not go through `/v1/`.

## Start Both Stacks

Start the LLM control plane with the ComfyUI-aware overlay:

```bash
cd dgx-spark-inference-stack
docker compose \
  -f docker-compose.yml \
  -f integrations/comfyui/docker-compose.dgx-spark-stack.yml \
  up -d

docker compose \
  -f docker-compose.yml \
  -f integrations/comfyui/docker-compose.dgx-spark-stack.yml \
  --profile models \
  up --no-start
```

Start ComfyUI with labels on the same runtime network:

This overlay keeps ComfyUI close to upstream. It only adds Docker labels so the stack can see that ComfyUI is an external GPU workload; it does not require a shared bridge or HTTP probing.

```bash
cd ../ComfyUI-DGX-Spark-Docker-opinionated
docker compose \
  -f docker-compose.yml \
  -f ../dgx-spark-inference-stack/integrations/comfyui/docker-compose.comfyui.yml \
  up -d --build
```

Expected endpoints:

```text
LLM API:  http://localhost:8009/v1/...
ComfyUI:  http://localhost:8188
Debug:    http://localhost:8009/debug/state
```

## External GPU Policy

Set `EXTERNAL_GPU_POLICY` before starting the LLM stack.

- `observe`: detect ComfyUI and report it in `/debug/state`; do not block or stop it.
- `block`: return HTTP 429 when a main/exclusive LLM is requested while ComfyUI is running.

Per-workload scheduler policy is carried in `dgx.spark.scheduler.policy` or workload-config `gpuPolicy`.

- `external-exclusive`: the workload is treated as GPU-exclusive and blocks main/exclusive LLM starts when `EXTERNAL_GPU_POLICY=block`.
- `observe`: the workload is still detected and shown in `/debug/state`, but it does not block managed LLM starts.

Start with `observe`. Move to `block` after `/debug/state` shows the ComfyUI container. Interruption modes such as `stop-idle`, `stop-always`, and automatic restart are not part of the MVP implementation.

## Inspect State

```bash
curl -sS http://localhost:8009/debug/state | jq '.runningExternal, .externalGpuPolicy'
```

With ComfyUI running, `runningExternal` should include an entry like:

```json
{
  "name": "comfyui",
  "container": "comfyui",
  "kind": "comfyui",
  "state": "running",
  "policy": "external-exclusive",
  "source": "label"
}
```

The `health` field in `/debug/state` is resolved from `http://host.docker.internal:${COMFY_PORT:-8188}/`, not from a shared inter-container network.
In this minimal mode, the stack detects ComfyUI from Docker state and labels alone. `health` is omitted unless you opt into a `dgx.spark.health-url` label or workload-config entry later.

## Expected Busy Error

With `EXTERNAL_GPU_POLICY=block`, a main/exclusive LLM request while ComfyUI is running should return HTTP 429:

```json
{
  "error": {
    "message": "GPU is busy with external workload 'comfyui'. Retry after it finishes, stop it manually, or set EXTERNAL_GPU_POLICY=observe.",
    "type": "rate_limit_error",
    "param": "model",
    "code": "external_gpu_busy"
  }
}
```

Utility model requests are not blocked by ComfyUI by default.

## Port Binding Note

The ComfyUI repository may bind port `8188` on all host interfaces. Prefer changing that repository's base Compose file to:

```yaml
ports:
  - "${COMFY_HOST_BIND:-127.0.0.1}:${COMFY_PORT:-8188}:${COMFY_PORT:-8188}"
```

Do not override `ports` from this integration overlay unless you have verified the rendered Compose output, because Compose list merge behavior can create duplicate host port bindings.
