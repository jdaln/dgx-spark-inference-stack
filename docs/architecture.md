# Architecture

Components, endpoints, request flow and model lifecycle.

| Service | Port | Role |
|---|---|---|
| API gateway (nginx) | 8009 | Single entry point. Routes `/v1/` traffic to the validator. |
| Request validator | 18081 | Checks the key, reads `model`, normalizes the request, asks the waker for the model, proxies to it. |
| Waker | 18080 | Starts and stops model containers, tracks health and idle time, allows one main model at a time. |
| Model containers | 8000 | vLLM, one model each, Compose profile `models`. |

The first three run all the time. Model containers start and stop on demand.

One main model runs at a time. The `utility` lane in `models.json` does not count, so the
small helper stays loaded next to a main model. An `exclusive` lane gets the GPU alone: the
waker stops the helper first. The waker starts the helper at boot, and again only after the
exclusive lane that displaced it is gone. A manual `docker stop` of the helper holds until
the next request for it.

## Endpoints

### Gateway, port 8009

- `GET /healthz`: gateway health.
- `POST /v1/*`: chat, completions, responses.
- `GET /debug/*`: the waker's debug endpoints, read-only.
- `POST /tokenize`, `POST /detokenize`: the engine's tokenizer endpoints. They pass through
  the validator, so the model wakes on demand and the count covers the normalized body.
  Same body as `/v1/chat/completions`, chat template applied. Returns
  `{count, max_model_len, tokens}`; a full-context call returns about 700 KB of token ids.

### Waker, internal port 18080

- `GET /healthz`: waker health.
- `GET /debug/state`: current state and configuration.
- `POST /ensure/<model>`: start the model and block until healthy.
- `POST /check/<model>`: non-blocking. 200 ready, 202 initializing, 429 busy, or a stored
  start failure.
- `POST /touch/<container>`: reset the idle timer. Internal network only.

## Request flow

1. The client posts to `http://localhost:8009/v1/chat/completions` with a `model` field.
2. nginx proxies `/v1/` to the request validator.
3. The validator checks the bearer key (401 otherwise) and calls `POST /ensure/<model>`.
4. The waker decides:
   - another main model is running: 429 with headers describing it;
   - the target is `exclusive` and the utility helper is up: stop the helper first;
   - the target is running: check health;
   - otherwise: start the container and wait for health.
5. On 200 the validator rewrites the request per the lane's `models.json` flags (tool
   handling, thinking and reasoning-effort mapping) and proxies it to the model container.
   Message structure belongs to the model's chat template.
6. On 429 the validator returns the busy response and `Retry-After` to the client.

The validator does not budget tokens. When a client omits `max_tokens`, vLLM uses
`max_model_len - prompt_tokens`. Other engines have their own defaults, so `models.json`
declares a `backend` per lane and the validator warns for a backend it has not verified.

## Lifecycle

1. The container starts on the first request for its model.
2. Every request resets the idle timer. The validator refreshes it while a response streams.
3. After `IDLE_STOP_SECONDS` (1200) idle and at least 30 s uptime, the waker stops it.
4. Stop has a 5 s grace period and a 20 s debounce.

The waker polls the model's `/health` every second and waits up to 15 minutes on
`/ensure`. A container that has never been healthy counts as starting, even when Docker
marks it `unhealthy`, for up to `MAX_STARTUP_SECONDS` (1 h). After that it is idle-stopped.

## Layout

```
docker-compose.yml          Control plane; includes the compose/ fragments
gateway.conf                nginx config
models.json                 Model inventory, read by the waker and the validator
compose/                    One fragment per model family
waker/                      Lifecycle manager
request-validator/          Validation and routing
shared/                     Code and model assets used by several services
custom-docker-containers/   Build inputs for the three runtime images
integrations/               Client configs and the ComfyUI overlays
tools/                      Validation, smoke, soak and benchmark scripts
skills/                     Step-by-step guides for coding agents
models/                     Weights, created at install
cache/<lane>/               Per-lane caches, created at runtime
manual_download/            Tokenizer files for the GPT-OSS image build
```
