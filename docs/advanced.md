# Advanced usage

Adding a model, changing the scheduler, keeping a model loaded. Coding agents: read
[AGENTS.md](../AGENTS.md) first.

## Adding a model

### 1. Add the compose service

Copy the nearest existing lane in the matching `compose/models-*.yml` file. Keep its
anchors: they carry the hardening that `tools/validate-stack.sh` requires (see
[security.md](security.md#model-containers)). Pin `--revision`. A new fragment must be listed
under `include:` in `docker-compose.yml`.

```yaml
services:
  vllm-my-model:
    <<: *model-profiled
    image: ${VLLM_TRACK_IMAGE_DFLASH2:-vllm-node-dflash2}
    container_name: vllm-my-model
    command:
      - vllm
      - serve
      - org/model-name
      - --revision
      - <commit>
      - --host
      - 0.0.0.0
      - --port
      - "8000"
      - --served-model-name
      - my-model
      - --gpu-memory-utilization
      - "0.80"
      - --disable-uvicorn-access-log
      - --disable-log-stats
    volumes:
      - ../models:/models:ro
      - ../cache/vllm-my-model/huggingface:/root/.cache/huggingface
    environment:
      <<: *env-common
    healthcheck:
      <<: *healthcheck-default
```

### 2. Add the inventory entry

The model does not exist for the gateway until it is in `models.json`. Fields:
[configuration.md](configuration.md#modelsjson).

```json
{
  "my-model": {
    "container": "vllm-my-model",
    "maxModelLen": 131072,
    "toolSupport": "full",
    "lifecycle": "normal",
    "experimental": true
  }
}
```

`gateway.conf` needs no change.

### 3. Check, download, start, reload

```bash
bash tools/validate-stack.sh
bash tools/check-models.sh
bash tools/download-weights.sh my-model
bash tools/run-model.sh --timeout 7200 --no-build my-model
bash tools/reload-control-plane.sh
```

Two traps:

- `reload-control-plane.sh` recreates containers from existing images. The waker and the
  validator bake their source into their images, so after a code change, rebuild:

  ```bash
  docker compose build waker request-validator
  docker compose up -d waker request-validator
  ```

- `gateway.conf` is a single-file bind mount. Most editors replace the file, and the mount
  keeps the old one, so `nginx -s reload` loads the old contents. Recreate instead:

  ```bash
  docker compose up -d --force-recreate api-gateway
  ```

### 4. Validate through the gateway

```bash
bash tools/test-lane.sh my-model
bash tools/smoke-gateway.sh
```

A lane that needs a custom parser, chat template or wrapper also gets its own live
regression under `tools/`.

### 5. Soak it

The checkpoint card and `max_position_embeddings` do not tell you what the host can serve.
Find the highest clean context tier through the gateway:

```bash
node tools/soak-context.mjs --model my-model --target-prompt-tokens 128000
```

Add `--disable-thinking` if reasoning uses up the answer budget, `--enable-thinking` to
test the other way.

### 6. Record the result

Write the highest clean tier, the first failing tier and any required request shape into
the lane's `notes`. Then set client limits, update [models.md](models.md) and drop
`experimental`.

## Changing scheduler policy

The waker runs one main model plus the utility lane. To allow more:

- Change the busy check in `waker/index.js` (`getRunningManagedExcept()`), not single call
  sites.
- Re-check the `--gpu-memory-utilization` totals. Concurrent main models on this host must
  stay under about 0.94 together.
- Decide what `exclusive` and `utility` mean once main models share the GPU.

## Keeping a model loaded

`/touch/<container>` resets the idle timer. It is on the internal network, so call it from
inside the waker container:

```bash
*/4 * * * * docker exec vllm-waker node -e "fetch('http://127.0.0.1:18080/touch/vllm-qwen3.8-27b-nvfp4-dflash2',{method:'POST'})"
```

Or set `IDLE_STOP_SECONDS=0` to turn idle stop off for every lane.
