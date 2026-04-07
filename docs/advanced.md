# Advanced Usage

## Adding a New Model

1. Add a model service to a compose file under `compose/` (usually one of the existing family files such as `compose/models-qwen.yml`, `compose/models-gemma.yml`, or a new `compose/models-custom.yml` if there is no existing family fit):
```yaml
services:
  vllm-my-model:
    profiles: ["models"]
    image: vllm-node
    container_name: vllm-my-model
    command:
      - vllm
      - serve
      - org/model-name
      - --host
      - 0.0.0.0
      - --port
      - "8000"
      - --download-dir
      - /models
      - --served-model-name
      - my-model
      - --gpu-memory-utilization
      - "0.82"
      # ... copy the remaining flags, volumes, env, and healthcheck from the nearest existing model
```

2. Make sure the compose fragment is included from `docker-compose.yml`:
```yaml
include:
  - compose/models-custom.yml
```

3. Add the model to `models.json` so both waker and request-validator load the same inventory:
```json
{
  "my-model": {
    "container": "vllm-my-model",
    "port": 8000,
    "maxModelLen": 131072,
    "toolSupport": "full",
    "validatorProfile": "default",
    "lifecycle": "normal",
    "experimental": true
  }
}
```

4. Run the structural checks before starting the model:
```bash
bash tools/validate-stack.sh
```

5. Start the model through the compose-native harness:
```bash
bash tools/run-model.sh --timeout 7200 --no-build my-model
```

6. Reload the control plane if you changed only `models.json` or lifecycle mappings and need waker/request-validator to pick up the new config:
```bash
bash tools/reload-control-plane.sh
```

7. Run the standard request-path checks for the new model.

If the model is intended to participate in the normal gateway workflow, run at least:
```bash
bash tools/smoke-gateway.sh
```

8. Always run a soak after adding a new model to determine the real safe context ceiling on this host.

This is mandatory for new-model bring-up in this repo. Do not guess the context limit from the checkpoint card or from the raw `max_position_embeddings` value. Use `tools/soak-context.mjs` to find the highest clean tier and the first borderline tier on the actual gateway path.

Example pattern:
```bash
node tools/soak-context.mjs \
  --model my-model \
  --target-prompt-tokens 64000 \
  --concurrency 5 \
  --requests 5 \
  --max-tokens 256
```

If the model defaults to hidden reasoning and that consumes the visible answer budget, include:
```bash
node tools/soak-context.mjs \
  --model my-model \
  --target-prompt-tokens 64000 \
  --concurrency 5 \
  --requests 5 \
  --max-tokens 256 \
  --disable-thinking
```

9. Record the soak result in the repo before treating the model as a recommended choice.

At minimum, update the model notes in `models.json` with:
- the highest clean tested prompt tier
- the first known borderline or failing tier
- any request-shape requirement such as non-thinking defaults

Only after that should you tighten client-facing limits, update docs, or consider promotion beyond `experimental`.

No changes to `gateway.conf` are needed for normal model additions. All `/v1/` traffic is routed through request-validator, which uses `models.json` plus the shared loader to resolve the target model.

## Disabling Single-Tenant Mode

To allow multiple models simultaneously:
- Remove the busy check logic in `waker/index.js` (`getRunningManagedExcept`)
- Ensure sufficient GPU memory for multiple models
- Adjust `--gpu-memory-utilization` accordingly

## Persistent Model Keep-Alive

Create a cron job to touch the model:
```bash
*/4 * * * * curl -X POST http://localhost:8009/debug/touch/vllm-qwen-math
```
