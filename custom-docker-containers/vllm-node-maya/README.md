# vllm-node-maya

[Project Maya](https://github.com/mw00/project-maya)'s engine and server, cut down and
contained for the two GLM lanes: `glm-5.3-flash-maya-s` and `glm-5.3-flash-maya-s-ablated`.
GLM-5.3-Flash (320B parameters) does not fit in this host's memory under vLLM; Maya serves a
low-bit GGUF tier of it.

Upstream is not trusted. Its code never runs on the host: the build, the pack builder and the
server all run in containers, and the server has no network.

## Build

From the repo root, on the Spark (aarch64, about 15 minutes):

```bash
docker compose --profile models build vllm-glm-5.3-flash-maya-s 2>&1 | tee tmp/checks/build-maya.log
```

The build context is `custom-docker-containers/`. Inputs are pinned in the `Dockerfile`:
base images by digest, Maya and llama.cpp by commit, Python packages by hash
(`requirements.lock`). They are fetched first. Patching, compiling and the gates then run with
`RUN --network=none`.

The image is built only if its gates pass:

| Gate | What it proves |
|---|---|
| Pin checks | Maya's version and its own llama.cpp pin match the `Dockerfile`'s. |
| `git apply`, no fuzz | Every patch still applies to the pinned source. |
| ggml patch stamp | Maya's CUDA kernel patch was applied (CMake only warns when it is not, and the engine then exits at run time). |
| `audit.py` | No outbound-capable call is left in Maya's code, beyond `audit-allow.txt`. |
| `test_maya_lane.py` | The entrypoint: config, forced switches, log gate, pack builder. |
| `selftest.py` | With Maya's mock engine: four routes answer, every other route is a 404, a browser `Origin` is accepted, nothing about a request is printed, nothing is written. |
| Synthetic pack | The pack builder indexes Maya's 12 MB synthetic model, as upstream's own image check does. That model carries no tokenizer, so it cannot be served. |

## What is changed

| File | Change |
|---|---|
| `patches/0001` | The server answers `GET /health`, `POST /v1/chat/completions`, `POST /tokenize` and `POST /detokenize`. Every other route is a 404: dashboard, settings, model management, updates, MCP, the Ollama, Responses and Anthropic APIs. |
| `patches/0002` | No request is refused for its `Origin` header. The stack's gateway owns that policy and forwards the header of the clients it admits. |
| `patches/0003` | Chat requests ignore the web app's `strata_resume` and `strata_mcp` fields. The first keeps whole answers on disk. |
| `patches/0004` | An image is read from a `data:` URL only: no URL fetch, no local file. |
| `stubs/` | Inert `serve/update.py`, `serve/model_pull.py` and `serve/mcp.py`. The update check, the downloader and the MCP client are not in the image. |

Not copied into the image: `maya.py`, `setup.py` and `chat.py` (installer, downloader,
terminal chat), `serve/web` (dashboard), tests and benches. Not built: the other engines and
the image encoder.

`maya_lane.py` is the entrypoint. `maya-lane` takes the flags the stack's tools parse, writes
Maya's config into a folder the server cannot write to, forces the privacy switches and closes
stdout once the port is bound: Maya prints a line per request there, and quotes model output.
`VLLM_LOGGING=1` keeps stdout open. `maya-lane-pack` builds the pack Maya serves from;
`tools/download-weights.sh` runs it.

The lane keeps no cache. Maya compiles nothing at start, and CUDA's own kernel cache is off
(`CUDA_CACHE_DISABLE=1`): it is written in about a second, so keeping it would not make a
start faster.

## Memory

On this host the GPU's memory is the system's RAM. Maya takes `MemAvailable` less
`--ram-headroom-gb` for its expert pool and ignores cgroup limits, so the headroom is the
lane's memory bound. `MemAvailable` counts the file cache as free. When the engine's memory
leaves under about 2 GB truly free, long prompts read about six times slower for as long as
that engine runs (130 against 750 tokens/s on a 22K-token prompt). Short prompts and the
answer's speed are unchanged, and neither a restart nor freeing memory afterwards clears it.

`maya-lane` therefore, before the engine starts:

- asks the kernel to drop its cached copies of the weight files under `/models`, other lanes'
  included (the lane is exclusive; nothing is lost, later reads come from the disk);
- raises the headroom when file cache it cannot drop is still in the way, to that cache plus
  7 GB (the model files Maya keeps mapped) plus 4 GB. The pool then holds fewer experts and
  answers come slower, but prompts keep their speed. The log says so.

At ready it prints `memory at ready: N GB free`. Under 2.5 GB it adds a warning: see
[docs/troubleshooting.md](../../docs/troubleshooting.md#glm-reads-long-prompts-slowly).
`tools/test-maya-lane.sh` times a 22K-token prompt.

## Refusal ablation

Maya can project a model's refusal direction out of its answers, from a small file its quant
repository ships. `maya-lane` takes it as a flag, and the stack has one lane for each value,
so the model id says what a client gets:

- `--ablate off` (`glm-5.3-flash-maya-s`): the direction is not loaded, the model is served
  as published, and a request that sends `"ablate": true` gets a 400.
- `--ablate on` (`glm-5.3-flash-maya-s-ablated`): the direction is applied to every request
  that does not send `"ablate": false`.

### One engine for both ids

The two lanes cannot run together. While one is up, a request for the other gets a 429 until
the first has been idle for 20 minutes or is stopped. Maya could serve both ids from one
engine: once the direction is loaded it applies it per request, per conversation slot, so
plain and ablated requests can run side by side. What that would take:

| Part | Change |
|---|---|
| `maya_lane.py` | A third value of `--ablate`: the direction loaded, Maya's own default off, so a request is ablated only when its `ablate` field says so. One container with it. |
| `models.json`, `shared/models-config.mjs` | One model id owns one container today, and a second id on the same container is rejected. It needs an alias form: an id that names another id as its lane and carries a request field to force, `"ablate": true`. The plain id forces `"ablate": false`. |
| Request validator | Follow the alias before asking the waker and before proxying, send the lane's served name as `model`, and overwrite `ablate` from the id, whatever the client sent. List both ids in `/v1/models`. |
| Waker | Nothing, as long as it only ever sees the lane's own id. |
| Tools | `check-models.sh`, `test-lane.sh`, `test-maya-lane.sh`, `bench-lane.mjs`, `soak-context.mjs` and `download-weights.sh --list` find a model's container by its id. Each must follow an alias to its lane. |
| Tests | Validator tests for the alias and the forced field. On the running lane, proof that a plain-id request stays unablated even when it sends `"ablate": true`. |

What it would cost the plain id: today the direction is not in its engine at all. With one
engine that guarantee rests on the validator overwriting one request field, and a request
sent straight to the container could ask for either. A conversation that moves between the
two ids also loses its cached context: Maya continues none across the two settings.

## Upgrading Maya

Maya fixes security issues only in its latest release.

1. Set `MAYA_SHA`, `MAYA_VERSION` and, if Maya moved its pin, `LLAMA_CPP_SHA` in the
   `Dockerfile` and in `build-metadata.yaml`.
2. Build. A patch that no longer applies stops the build: rework it against the new source
   (`git apply` in a checkout of the new commit, then `git diff`).
3. Read the audit's findings before adding a line to `audit-allow.txt`.
4. Read Maya's changelog for new files it writes, new routes and new settings, and check
   them against `maya_lane.py` and `selftest.py`.
5. For another model or tier, measure what Maya keeps mapped of its files (`RssFile` in the
   engine's `/proc/<pid>/status`) and set `ENGINE_FILES_GB` in `maya_lane.py`.
6. Rerun the lane's checks: `tools/test-maya-lane.sh`, then the `model-bring-up` skill from
   step 7.
