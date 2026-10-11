---
name: model-bring-up
description: Add, adapt, revive or validate a model lane in this stack, from compose fragment and models.json through weights, gateway checks, soak and benchmark. Use when a task adds a model, changes a lane's image or runtime shape, or asks whether a lane works.
---

# Model bring-up

A lane is done when the gateway path works on this host and the repo records what was
validated. [AGENTS.md](../../AGENTS.md) has the rules; this is the sequence. Every check
leaves a result file in `tmp/` (see [Results](#results)). Run `mkdir -p tmp/checks` once.

1. Copy the nearest lane in `compose/models-*.yml`. Inherit the fragment anchors: they carry
   the hardening `validate-stack` requires (no capabilities, `no-new-privileges`, internal
   network only, Hugging Face offline from `/models`). Pin `--revision`. Use
   `--distributed-executor-backend mp`; Ray cannot place workers without a default route.
   Check the effective image, command, environment and mounts:

   ```bash
   bash tools/inspect-model.sh <model-id> 2>&1 | tee tmp/checks/<model-id>-inspect.log
   ```

2. Add the `models.json` entry: container, `maxModelLen`, lifecycle, `toolSupport`,
   `multimodal`, `reasoningEffort`, `speculativeDecoding` (true exactly when the command has
   `--speculative-config`), and `experimental: true`.
3. Offline checks: the `stack-checks` skill, offline part.
4. Weights. Lanes never download at runtime.

   ```bash
   bash tools/download-weights.sh --list                 # every lane: weights present, image built
   bash tools/download-weights.sh <model-id> --dry-run   # repo@revision, plus any draft model
   bash tools/download-weights.sh <model-id>
   ```

5. After editing `models.json`, `request-validator/` or `waker/`, rebuild and reload before
   judging gateway behavior:

   ```bash
   docker compose build waker request-validator && bash tools/reload-control-plane.sh
   ```

6. Start the lane. A new or changed shape starts first under the memory guard: GPU and system
   RAM are one pool, and an unguarded start has taken the host down. The `.` filter keeps the
   committed command.

   ```bash
   bash tools/run-variant.sh --mem-limit 100g <model-id> first-start '.' 2>&1 | tee tmp/checks/<model-id>-first-start.log
   bash tools/run-variant.sh --restore <model-id>
   bash tools/run-model.sh --timeout 7200 --no-build <model-id> 2>&1 | tee tmp/checks/<model-id>-start.log
   ```

   `Operation not permitted` in the lane's logs means seccomp: see
   [docs/security.md](../../docs/security.md#seccomp).
7. Gateway capabilities, per the lane's `models.json` flags (chat, system turn, leaked
   `<pad>`, streaming, tokenize and detokenize, tool calls auto and required, a streamed tool
   call, image input, effort mapping, default thinking state):

   ```bash
   bash tools/test-lane.sh <model-id>
   ```

   If a check fails, compare the direct path inside the container:

   ```bash
   docker exec <container> curl -s localhost:8000/v1/chat/completions \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" -H 'Content-Type: application/json' \
     -d '{"model": "<model-id>", "messages": [{"role": "user", "content": "Hello"}]}' \
     | tee tmp/checks/<model-id>-direct.json
   ```

8. Error envelope, then the shared matrix (needs the GPU free; roles can be pointed at other
   lanes with `DEFAULT_MODEL`, `CODER_MODEL`, `VL_MODEL`). For a speculative lane, set
   `SPEC_MODEL=<model-id>` so its `min_p` rejection is tested:

   ```bash
   SPEC_MODEL=<model-id> bash tools/smoke-errors.sh 2>&1 | tee tmp/checks/smoke-errors.log
   bash tools/smoke-gateway.sh 2>&1 | tee tmp/checks/smoke-gateway.log
   ```

9. Context soak at production shape (no client `max_tokens`), in a container:

   ```bash
   docker run --rm --network host -u "$(id -u):$(id -g)" -e VLLM_API_KEY \
     -v "$PWD":/workspace -w /workspace node:22-bookworm \
     node tools/soak-context.mjs --model <model-id> --target-prompt-tokens <n>
   ```

10. Speed, prefill, throughput and quality under 8 concurrent requests (on the host: it
    drives Docker): `node tools/bench-lane.mjs --model <model-id>`. Use the `lane-tuning`
    skill to compare shapes.
11. A custom parser, template or wrapper gets its own live gateway regression under `tools/`,
    which also writes its result to `tmp/`.
12. Commit the production shape (access, request and stats logs off). Record limits, the
    required request shape and known failures in the lane's `models.json` notes, and speeds
    in `docs/models.md`. Notes hold the current shape only: replace superseded figures.

## Results

| Check | Result file |
|---|---|
| `test-lane.sh` | `tmp/test-lane/summary-<time>.txt`, bodies in `tmp/test-lane/<model-id>/` |
| `soak-context.mjs` | `tmp/soak/<model-id>-<tokens>-<time>.json` |
| `bench-lane.mjs` | `tmp/bench/<model-id>-<label>-<time>.json` |
| everything else | `tmp/checks/*.log`, through `tee` |

Report the files changed, the runtime shape, the checks that passed with their result files,
and what is unvalidated.
