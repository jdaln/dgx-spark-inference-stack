---
name: stack-checks
description: The checks to run before committing changes to compose fragments, models.json, request-validator, waker, shared/ or tools/ in this repo. Use after any such edit and before reporting it done.
---

# Stack checks

Every check must leave its result in a file under `tmp/`, so it can be read after the run.
Save console output with `tee`, which runs on the host:

```bash
mkdir -p tmp/checks
```

`tee` hides the exit code: read the log. A failure shows as `FAIL`, `not ok`, or a
non-zero `# fail` count.

## Offline

No GPU or running stack needed. CI runs the same set.

If you changed a file the soak bundle embeds (`request-validator/index.js`,
`waker/index.js`, `shared/models-config.mjs`, `gateway.conf`), first run
`bash tools/build-soak-bundle.sh`.

```bash
bash tools/validate-stack.sh 2>&1 | tee tmp/checks/validate-stack.log            # compose, lane hardening, models.json, soak bundle
bash tools/check-supply-chain-pinning.sh 2>&1 | tee tmp/checks/pinning.log       # image digests, action pins
bash tools/lib/common.test.sh 2>&1 | tee tmp/checks/common-test.log              # weight helpers
docker run --rm -v "$PWD":/workspace:ro -w /workspace node:20-alpine \
  node tools/bench-lane.mjs --self-test 2>&1 | tee tmp/checks/bench-self-test.log
docker run --rm -v "$PWD":/workspace -w /workspace/request-validator node:20-alpine \
  sh -lc "npm ci && npm test" 2>&1 | tee tmp/checks/validator-tests.log
docker run --rm -v "$PWD":/workspace -w /workspace/waker node:20-alpine \
  sh -lc "npm ci && npm test" 2>&1 | tee tmp/checks/waker-tests.log
```

`validate-stack.sh` also runs `check-models.sh` and the soak bundle check.

## Live, with the stack up

```bash
docker compose build waker request-validator && bash tools/reload-control-plane.sh   # after validator, waker or models.json edits
bash tools/smoke-errors.sh 2>&1 | tee tmp/checks/smoke-errors.log      # error envelope; starts no model
bash tools/test-lane.sh <model-id>                                      # summary in tmp/test-lane/summary-<time>.txt
bash tools/smoke-gateway.sh 2>&1 | tee tmp/checks/smoke-gateway.log    # shared matrix; needs the GPU free
```

## Host or container

Scripts that drive Docker run on the host: `validate-stack`, `check-*`, `download-weights`,
`run-model`, `run-variant`, `inspect-model`, `test-lane`, `smoke-*` and `bench-lane`.
Everything else runs in a container: unit tests and the bench self-test in
`node:20-alpine`, the context soak in `node:22-bookworm` (it needs `curl`). Python never runs
on the host.
