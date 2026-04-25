# Tools and Validation Harness

The repo's supported operational tooling now lives under `tools/`. The old top-level `debugging/` folder has been folded into this area so newcomers only have one place to look for validation scripts, manual probes, and optional compatibility workarounds.

If the docs and scripts disagree, prefer `tools/` plus `models.json` over older notes.

## Recommended Workflow

For a normal model bring-up or regression check, use this order:

1. `bash tools/validate-stack.sh`
2. `bash tools/run-model.sh --no-build <model-id>`
3. `bash tools/smoke-gateway.sh`
4. `node tools/soak-context.mjs --model <model-id> --target-prompt-tokens <n>`

## Maintained Entry Points

- `validate-stack.sh` renders the active compose config and runs structural assertions for the current supported services.
- `check-models.sh` cross-checks the active compose fragments against `models.json`.
- `inspect-model.sh` prints the effective image, command, environment, bind mounts, and healthcheck for a model without starting it.
- `run-model.sh` starts one model through the current scheduler rules and waits for Docker health.
- `reload-control-plane.sh` reloads `waker` and `request-validator` after `models.json` changes.
- `smoke-gateway.sh` exercises the supported gateway-path smoke matrix.
- `soak-context.mjs` calibrates and runs long-context soak probes against the real gateway path.

## Manual Utilities

- `test-model.py` is a lightweight direct probe for one-off text or tool-call checks against `/v1/chat/completions`.
- `streaming-proxy/` contains an optional FastAPI shim for clients that need non-streaming tool-call responses re-emitted as SSE.

Quick examples:

```bash
# Plain text probe
python3 tools/test-model.py --model qwen2.5-1.5b-instruct

# Tool-call probe
python3 tools/test-model.py --model qwen2.5-1.5b-instruct --tool-call

# Optional SSE compatibility shim for strict clients
docker build -t vllm-streaming-proxy -f tools/streaming-proxy/Dockerfile tools/streaming-proxy
docker run --rm -p 9000:9000 \
	--add-host host.docker.internal:host-gateway \
	-e UPSTREAM_BASE=http://host.docker.internal:8009/v1 \
	vllm-streaming-proxy
```

## Internal Helpers

- `lib/common.sh` holds shared shell helpers for compose rendering, health waits, and path resolution.
- `lib/resolve-compose-service.mjs` maps a model id, compose service, or container name to its effective rendered service definition.
- `testdata/` stores bundled filler/context files used by the soak harness.

## Legacy

- `legacy/verify-memory.sh` is kept for historical reference only. It assumes an older service and model inventory and is not part of the supported harness anymore.
