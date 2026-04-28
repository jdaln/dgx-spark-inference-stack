# Runtime Baseline

Reviewed on 2026-04-24.

This repo does not run a single universal vLLM baseline. Different model families sit on different local image tracks, so rebuild instructions and debugging assumptions need to follow the actual track a service uses.

## Active Runtime Tracks

| Track | Default image/tag in compose | Used by | Build source |
| --- | --- | --- | --- |
| Avarok general-purpose | `${VLLM_TRACK_AVAROK:-avarok/vllm-dgx-spark:v11@sha256:246723e9a74163e7828716c1587d6c5208a9cf0dc8d1195cbd33f68234b1024b}` | `compose/models-llama.yml`, the FP4/experimental Avarok-backed lanes in `compose/models-glm.yml`, `compose/models-qwen.yml`, and `compose/models-experimental.yml` | Repo-local Dockerfile in `custom-docker-containers/avarok/` or pinned upstream pull |
| Standard | `${VLLM_TRACK_IMAGE_STANDARD:-vllm-node}` | `compose/models-nemotron.yml` and future standard-track follow-ons | Upstream helper repo in `tmp/spark-vllm-docker` |
| TF5 (Gemma and newer TF5 Qwen services) | `vllm-node-tf5` or `${VLLM_TRACK_IMAGE_TF5:-vllm-node-tf5}` | `compose/models-gemma.yml` and the TF5-backed Qwen follow-ons in `compose/models-qwen.yml` | Upstream helper repo in `tmp/spark-vllm-docker` |
| TF5 (legacy GLM fallback) | `${VLLM_TRACK_IMAGE_TF5:-local/vllm-node-tf5:cu131}` | `vllm-glm-4.6v-flash-fp4` in `compose/models-glm.yml` | Repo-local custom image layered over `vllm-node-mxfp4` |
| GLM 4.7 local TF5 variant | `local/vllm-glm-4.7-flash-awq:tf5` via the GLM 4.7 build stanza | `glm-4.7-flash-awq` | Repo-local custom image layered over `local/vllm-node-tf5:cu131` |
| MXFP4 | `${VLLM_TRACK_IMAGE_MXFP4:-vllm-node-mxfp4}` | GPT-OSS services in `compose/models-gpt.yml` | Repo-local Dockerfile in `custom-docker-containers/vllm-node-mxfp4/` |

## What To Rebuild

### `avarok/vllm-dgx-spark:v11`

The Avarok-backed FP4 services can keep the pinned upstream default or consume a local rebuild, but local use now requires an explicit override because the compose default is digest-pinned:

```bash
docker build -t avarok/vllm-dgx-spark:v11 -f custom-docker-containers/avarok/Dockerfile .
export VLLM_TRACK_AVAROK=avarok/vllm-dgx-spark:v11
```

### `vllm-node-tf5`

The active Gemma services expect the local image tag `vllm-node-tf5`.

```bash
git clone https://github.com/eugr/spark-vllm-docker tmp/spark-vllm-docker 2>/dev/null || \
  git -C tmp/spark-vllm-docker pull --ff-only

docker login nvcr.io

(cd tmp/spark-vllm-docker && bash build-and-copy.sh --pre-tf)

docker image inspect vllm-node-tf5 >/dev/null
```

### `vllm-node`

The current standard-track reference also comes from the same upstream helper repo:

```bash
git clone https://github.com/eugr/spark-vllm-docker tmp/spark-vllm-docker 2>/dev/null || \
  git -C tmp/spark-vllm-docker pull --ff-only

docker login nvcr.io

(cd tmp/spark-vllm-docker && bash build-and-copy.sh)

docker image inspect vllm-node >/dev/null
```

### `vllm-node-mxfp4`

The repo owns the MXFP4 build context directly:

```bash
docker build -t vllm-node-mxfp4 -f custom-docker-containers/vllm-node-mxfp4/Dockerfile .
```

## Operational Notes

- `models.json` is the lifecycle source of truth for which container is the `utility` helper and which models are `exclusive`.
- `tools/run-model.sh` mirrors the current scheduler rules: it stops other running main-model containers before a manual test run, keeps the utility helper unless the target is exclusive, and stops running exclusive models before starting the utility helper.
- On this DGX Spark host, the small `qwen3.5-0.8b` utility helper can coexist with validated main lanes, but two substantial main models should still be treated as mutually exclusive in practice. The combined budget for concurrently loaded substantial main models is only about `0.94`.
- If a large model dies during load, treat memory headroom as a first-class hypothesis before assuming the runtime baseline is wrong.

## Why This Doc Exists

When a service fails, the first useful question is not just "which model is this?" but also "which runtime track is it actually using?" The answer changes:

- which upstream repo or Dockerfile should be compared,
- which build command reproduces the image,
- which parser/runtime bugs are even relevant,
- and whether a failure is more likely to be a runtime mismatch or plain memory pressure.
