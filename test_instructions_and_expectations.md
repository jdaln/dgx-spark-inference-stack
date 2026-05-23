# DGX Test Instructions And Expectations

Use this when local implementation is complete and you are testing on the real DGX Spark host. Return the command output and any deviations from the expected results.

## 1. Render Compose Configs

```bash
cd dgx-spark-inference-stack

docker compose \
  -f docker-compose.yml \
  -f integrations/comfyui/docker-compose.dgx-spark-stack.yml \
  config >/tmp/dgx-stack-rendered.yml
```

Expected:

- Command exits `0`.
- No duplicate port binding error.
- `vllm-waker` render includes `extra_hosts: host.docker.internal:host-gateway`.

If your machine only has `docker-compose`, use the same arguments with `docker-compose`.

## 2. Start In Observe Mode

```bash
cd dgx-spark-inference-stack
EXTERNAL_GPU_POLICY=observe docker compose \
  -f docker-compose.yml \
  -f integrations/comfyui/docker-compose.dgx-spark-stack.yml \
  up -d --build

docker compose \
  -f docker-compose.yml \
  -f integrations/comfyui/docker-compose.dgx-spark-stack.yml \
  --profile models \
  up --no-start
```

Expected:

- `vllm-waker`, `vllm-request-validator`, and `vllm-gateway` are healthy/running.
- `curl -sS http://localhost:8009/healthz` returns `ok`.

## 3. Start ComfyUI With Labels

```bash
cd ../ComfyUI-DGX-Spark-Docker-opinionated
docker compose \
  -f docker-compose.yml \
  -f ../dgx-spark-inference-stack/integrations/comfyui/docker-compose.comfyui.yml \
  up -d --build
```

Expected:

- ComfyUI is reachable at `http://localhost:8188`.
- `docker inspect comfyui | jq '.[0].Config.Labels'` includes `dgx.spark.gpu-workload: "true"` and `dgx.spark.scheduler.policy: "external-exclusive"`.

## 4. Confirm Detection

```bash
curl -sS http://localhost:8009/debug/state | jq '.externalGpuPolicy, .runningExternal'
```

Expected:

- `.externalGpuPolicy` is `"observe"`.
- `.runningExternal[]` contains `container: "comfyui"` and `kind: "comfyui"`.
- Detection source is preferably `"label"`; `"env"` is acceptable only if labels are missing and fallback name detection is active.

## 5. Confirm Observe Does Not Block

Use a normal/main model that is practical on the host, for example:

```bash
curl -sS -D /tmp/observe.headers -o /tmp/observe.body \
  http://localhost:8009/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"glm-4.7-flash-awq","messages":[{"role":"user","content":"Reply with ok."}],"max_tokens":16,"stream":false}'

cat /tmp/observe.headers
jq . /tmp/observe.body
```

Expected:

- Request is not rejected with `external_gpu_busy`.
- It may take normal cold-start time.
- If another managed LLM is already running, `model_busy` is acceptable and unrelated to ComfyUI.

## 6. Switch To Block Mode

```bash
cd ../dgx-spark-inference-stack
EXTERNAL_GPU_POLICY=block docker compose \
  -f docker-compose.yml \
  -f integrations/comfyui/docker-compose.dgx-spark-stack.yml \
  up -d --build waker request-validator api-gateway
```

Confirm:

```bash
curl -sS http://localhost:8009/debug/state | jq '.externalGpuPolicy, .runningExternal'
```

Expected:

- `.externalGpuPolicy` is `"block"`.
- `.runningExternal[]` still contains `comfyui`.

## 7. Confirm Block Policy Error

With ComfyUI still running:

```bash
curl -sS -D /tmp/block.headers -o /tmp/block.body \
  http://localhost:8009/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"glm-4.7-flash-awq","messages":[{"role":"user","content":"Reply with ok."}],"max_tokens":16,"stream":false}'

cat /tmp/block.headers
jq . /tmp/block.body
```

Expected:

- HTTP status is `429`.
- Body has `.error.code == "external_gpu_busy"`.
- Body has `.error.type == "rate_limit_error"`.
- Headers include `Retry-After`, `X-DGX-Busy-Workload`, and `X-DGX-External-GPU-Policy`.

## 8. Confirm Utility Is Not Blocked

```bash
curl -sS -D /tmp/utility.headers -o /tmp/utility.body \
  http://localhost:8009/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3.5-0.8b","messages":[{"role":"user","content":"Reply with ok."}],"max_tokens":16,"stream":false}'

cat /tmp/utility.headers
jq . /tmp/utility.body
```

Expected:

- Utility request is not rejected with `external_gpu_busy`.
- A normal model cold start, health timeout, or model-specific failure should be reported separately.

## 9. Confirm Error Contract Smoke

```bash
cd dgx-spark-inference-stack
tools/smoke-errors.sh
```

Expected:

- Invalid JSON returns `invalid_json`.
- Missing model returns `missing_model`.
- Unknown model returns `model_not_found`.
- No response contains top-level `ok:false` for `/v1/` client-facing errors.

## Return This Result

Paste back:

```text
Host:
Git commit:
Docker version:
Compose command used:

1 compose render:
2 observe startup:
3 ComfyUI labels:
4 debug state observe:
5 observe model request:
6 block restart/debug:
7 block model request:
8 utility request:
9 smoke-errors:

Unexpected behavior:
Logs worth inspecting:
```
