# Configuration

Environment variables, the `models.json` inventory and per-model tuning.

## Environment variables

Set these in a `.env` file at the repo root, or in the shell before `docker compose up`.

| Variable | Default | Effect |
|---|---|---|
| `VLLM_API_KEY` | `63TestTOKEN0REPLACEME` | API key clients must send. Change it. |
| `VLLM_LOGGING` | `0` | `1` turns on vLLM's normal log output. `0` logs warnings and tracebacks only. |
| `WAKER_VERBOSE` | `0` | `1` logs every request in the waker and the validator. |
| `DOCKER_LOG_DRIVER` | `json-file` | `none` turns Docker logging off. |

Image overrides (`VLLM_TRACK_IMAGE_MXFP4`, `VLLM_TRACK_IMAGE_DFLASH2`, `VLLM_TRACK_IMAGE_B12X`):
[runtime-baseline.md](runtime-baseline.md).

## Waker

Set on the `waker` service in `docker-compose.yml`. Defaults are the values in effect with the shipped compose file.

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `18080` | HTTP port. |
| `MANAGE_PREFIX` | `vllm-` | Container name prefix the waker manages. |
| `IGNORE_NAMES` | `vllm-gateway,vllm-waker,vllm-request-validator` | Never managed. |
| `IDLE_STOP_SECONDS` | `1200` | Idle time before a model stops. `0` disables idle stop. |
| `NO_STOP_BEFORE_SECONDS` | `30` | Minimum uptime before a stop. |
| `HEALTH_TIMEOUT_MS` | `900000` | How long `/ensure/<model>` waits for health. Does not change the container's Docker healthcheck. |
| `DOCKER_STOP_TIMEOUT_SECONDS` | `5` | Grace period on stop. |
| `TICK_MS` | `1000` | State check interval. |
| `STOP_DEBOUNCE_MS` | `20000` | Minimum time between stop attempts on one container. |
| `BUSY_STATUS_CODE` | `429` | Status when the GPU is taken. |
| `ENSURE_ERROR_TTL_MS` | `30000` | How long `/check` reports a failed start before it retries. |
| `MAX_STARTUP_SECONDS` | `3600` | How long a never-healthy container may keep loading before it is idle-stopped. |
| `MODEL_HEALTH_URL_TEMPLATE` | `http://{name}:8000/health` | Health URL pattern. |
| `MODELS_DIR` | `/models` | Read-only mount of `./models`. A lane whose weights are missing gets `model_weights_missing` before anything starts. Without the mount the check is skipped. |
| `EXTERNAL_GPU_POLICY` | `observe` | ComfyUI and other external GPU workloads. See [comfyui-coexistence.md](comfyui-coexistence.md). |

## Request validator

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `18081` | HTTP port. |
| `WAKER_URL` | `http://waker:18080` | Waker base URL. |
| `MODELS_CONFIG_PATH` | `/config/models.json` | Inventory path inside the container. |
| `MAX_BODY_BYTES` | `67108864` | Body size cap, same as the gateway's `client_max_body_size`. |
| `VLLM_API_KEY` | from `.env` | Bearer key for every route except `/healthz`. Empty disables the check. |
| `TOUCH_INTERVAL_MS` | `60000` | How often a running response resets the idle timer. |
| `VERBOSE` | `0` | `1` logs every request. |

## models.json

One entry per model, keyed by the model id clients send. The waker and the validator read
it at startup. After editing it, reload them:

```bash
bash tools/reload-control-plane.sh

# If you moved the utility role to another lane, also stop the old one:
bash tools/reload-control-plane.sh --stop-stale-utility
```

| Field | Values | Default | Effect |
|---|---|---|---|
| `container` | name | required | Container that serves the model. Must match `container_name` in compose. |
| `port` | integer | `8000` | Port inside the container. |
| `maxModelLen` | integer | required | Served context, same as `--max-model-len`. |
| `lifecycle` | `normal`, `utility`, `exclusive` | `normal` | `utility` stays loaded next to a main model; one lane at most. `exclusive` stops the utility lane first. |
| `backend` | `vllm`, `sglang`, `llamacpp` | `vllm` | Engine. The validator warns for engines whose default `max_tokens` it has not verified. |
| `toolSupport` | `full`, `force-required`, `none` | `full` | `none` strips tool fields. `force-required` sets `tool_choice=required` when tools are sent. |
| `validatorProfile` | `default`, `small-no-tools`, `vl`, `coder-force-tools`, `llama-tools` | `default` | `small-no-tools` and `vl` strip tools. `coder-force-tools` forces `tool_choice=required`. `llama-tools` adds Llama tool-calling guidance. |
| `multimodal` | boolean | `false` | Accepts image input. |
| `normalizeTextContent` | boolean | `false` | Joins array text content into one string for templates that accept only strings. Ignored on multimodal lanes. |
| `thinkingDefault` | `template`, `off` | `template` | `off` turns thinking off unless the client sets it. |
| `reasoningEffort` | `passthrough`, `binary`, `graded` | `passthrough` | `binary` maps `reasoning_effort` onto `enable_thinking`. `graded` maps it onto the Qwen3.8 levels `xhigh`, `medium`, `low`. |
| `reasoningEffortDefault` | `none`, `low`, `medium`, `high` | none | Graded lanes only. Effort used when the client sends no effort and no thinking flag. |
| `reasoningNeedsSpecialTokens` | boolean | `false` | Keeps special tokens in non-streaming responses with thinking on, so the reasoning parser can find the thinking channel. Gemma 4 needs it. |
| `speculativeDecoding` | boolean | `false` | Set when the command has `--speculative-config`. The validator then rejects `min_p` and `logit_bias`, which the engine ignores. |
| `experimental` | boolean | `false` | Not yet validated through the gateway and soaked. |
| `sourceRecipe` | string | none | Upstream recipe the lane follows. |
| `notes` | string | none | Measured limits and required request shape. |

`tools/check-models.sh` checks `models.json` against the compose fragments.

## Per-model tuning

GPU memory share, batch sizes, sequence limits and parser flags live in each model's
service under `compose/`. Main lanes take 0.50 to 0.80 of memory, the utility lane 0.06.
A non-exclusive main lane must leave room for the utility lane.

## Networks

- `default`: gateway traffic. The gateway publishes `127.0.0.1:8009` only.
- `vllm_internal`: internal, no egress. Waker, validator and model containers. Model
  containers join only this network.
