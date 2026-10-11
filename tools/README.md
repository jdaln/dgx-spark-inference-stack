# Tools

Validation, smoke, soak and benchmark scripts. They need bash, jq, Node and Docker on the
host. Python runs only in containers.

## Bring-up or regression check

```bash
bash tools/validate-stack.sh                 # structural checks
bash tools/download-weights.sh <model>       # fetch the pinned weights
bash tools/run-model.sh --no-build <model>   # start one model under the scheduler rules
bash tools/test-lane.sh <model>              # the model's capabilities through the gateway
bash tools/smoke-gateway.sh                  # shared gateway matrix
node tools/soak-context.mjs --model <model> --target-prompt-tokens <n>
node tools/bench-lane.mjs --model <model>    # speed, prefill, throughput, quality under load
```

A model with a custom parser, chat template or wrapper also needs its own live regression,
run after `test-lane.sh`.

## Scripts

| Script | Does |
|---|---|
| `validate-stack.sh` | Renders the compose config and checks its structure, lane hardening and weight references. |
| `check-models.sh` | Checks the compose fragments against `models.json`. |
| `check-supply-chain-pinning.sh` | Checks that external images are pinned by digest and GitHub Actions by commit. |
| `inspect-model.sh` | Prints a model's image, command, environment, mounts and healthcheck without starting it. |
| `download-weights.sh` | Downloads models' pinned weights, and their draft models, into `./models` from a temporary container with network access. `--list` shows every model with its weights and image status. The only download path: model containers run offline. |
| `run-model.sh` | Starts one model under the scheduler rules and waits for Docker health. |
| `reload-control-plane.sh` | Recreates the waker and the validator after `models.json` changes. |
| `test-lane.sh` | Checks models through the gateway per their `models.json` flags: cold start, chat with a system turn, leaked `<pad>` tokens, streaming, tokenize and detokenize, tool calls with `tool_choice` auto and required, a streamed tool call, image input, reasoning-effort mapping, default thinking state. Stops each model afterwards unless `--keep`. Results go to `tmp/test-lane/`. |
| `smoke-gateway.sh` | Runs the shared gateway matrix. Needs the GPU free. |
| `smoke-errors.sh` | Checks the error envelope: auth, bad JSON, missing and unknown model, unsupported sampling parameter. Starts no model. |
| `soak-context.mjs` | Runs long-context soaks through the gateway, calibrated to a target prompt size. Reports go to `tmp/soak/`. |
| `build-soak-bundle.sh` | Regenerates the soak filler from the control-plane source. `--check` fails if it is stale. |
| `run-variant.sh` | Starts a model with an edited copy of its command, as a compose override in `tmp/variants/`, for A/B tests with `bench-lane.mjs`. `--restore <model>` returns to the committed shape. Refuses to run next to another main model and stops the variant when free memory drops under `VARIANT_MIN_FREE_GIB` (10). |
| `bench-lane.mjs` | Benchmarks a model through the gateway: single-stream decode, prefill, throughput at several concurrency levels, and a graded quality battery under load. `--self-test` checks the graders offline. Reports go to `tmp/bench/`. |

## Manual probes

`test-model.py` sends one request to `/v1/chat/completions`. Run it in a container:

```bash
docker run --rm --network host -e VLLM_API_KEY -v "$PWD:/workspace:ro" -w /workspace \
	python:3.12-slim sh -c "pip install -q requests && python tools/test-model.py --model gpt-oss-20b --tool-call"
```

`streaming-proxy/` turns a non-streaming tool-call response into SSE, for clients that
cannot handle the streamed shape:

```bash
docker build -t vllm-streaming-proxy -f tools/streaming-proxy/Dockerfile tools/streaming-proxy
docker run --rm -p 127.0.0.1:9000:9000 \
	--add-host host.docker.internal:host-gateway \
	-e UPSTREAM_BASE=http://host.docker.internal:8009/v1 \
	vllm-streaming-proxy
```

Then point the client at `http://localhost:9000/v1`.

## Internals

- `lib/common.sh`: shared helpers for compose rendering, health waits and weight checks.
- `lib/resolve-compose-service.mjs`: maps a model id, service or container name to its
  rendered service.
- `lib/bench-quality.mjs`: the graded quality battery.
- `testdata/`: filler text for soaks and benchmarks.
