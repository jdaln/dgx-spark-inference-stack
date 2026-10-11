# ComfyUI coexistence

How to run `ComfyUI-DGX-Spark-Docker-opinionated` on the same host. The waker detects
ComfyUI as an external GPU workload and can refuse to start a model while it runs. ComfyUI
stays a separate Compose project: it is not in `models.json` and its traffic does not pass
through the gateway.

## Start both stacks

The LLM stack, with the overlay that configures detection in the waker:

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

ComfyUI, with the overlay that adds the detection labels:

```bash
cd ../ComfyUI-DGX-Spark-Docker-opinionated
docker compose \
  -f docker-compose.yml \
  -f ../dgx-spark-inference-stack/integrations/comfyui/docker-compose.comfyui.yml \
  up -d --build
```

ComfyUI then answers on `http://localhost:8188`.

## Policy

`EXTERNAL_GPU_POLICY`, set before starting the LLM stack:

- `observe` (default): detect ComfyUI and show it in `/debug/state`. Block nothing.
- `block`: answer 429 `external_gpu_busy` when a main or exclusive lane is requested while
  ComfyUI runs. The utility lane is never blocked.

A workload blocks only when its own policy is `external-exclusive`, the default; the other
value is `observe`. The policy comes from
the `dgx.spark.scheduler.policy` label, or from `gpuPolicy` in a workloads file named by
`WORKLOADS_CONFIG_PATH` (see `workloads.example.json`). A container named in
`EXTERNAL_GPU_CONTAINER_NAMES` (default `comfyui`) is detected without labels.

Start with `observe`. Switch to `block` once `/debug/state` shows the container.

## Verify

```bash
curl -sS http://localhost:8009/debug/state | jq '.externalGpuPolicy, .runningExternal'
```

With ComfyUI running, `runningExternal` holds an entry like:

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

Then check each policy with ComfyUI still running:

- `observe`: a request for `gpt-oss-20b` is not rejected with `external_gpu_busy`.
- `block`: the same request returns 429 `external_gpu_busy` with `Retry-After`,
  `X-DGX-Busy-Workload` and `X-DGX-External-GPU-Policy` headers.
- `block`: a request for `lfm2.5-1.2b` is not rejected.

To switch policy, recreate the control plane:

```bash
EXTERNAL_GPU_POLICY=block docker compose \
  -f docker-compose.yml \
  -f integrations/comfyui/docker-compose.dgx-spark-stack.yml \
  up -d waker request-validator api-gateway
```

## Port binding

The ComfyUI repo may bind 8188 on all interfaces. Change it in that repo's base Compose
file:

```yaml
ports:
  - "${COMFY_HOST_BIND:-127.0.0.1}:${COMFY_PORT:-8188}:${COMFY_PORT:-8188}"
```

Do not override `ports` from the overlay: Compose merges port lists and can produce
duplicate host bindings.
