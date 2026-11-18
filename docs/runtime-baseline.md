# Runtime baseline

The four runtime images and how to build them. A model starts only if its image exists
locally. `bash tools/download-weights.sh --list` shows which images are built.

| Image | Override | Models | Build |
|---|---|---|---|
| `vllm-node-mxfp4` | `VLLM_TRACK_IMAGE_MXFP4` | The three GPT-OSS models | One Dockerfile, about 20 minutes |
| `vllm-node-dflash2` | `VLLM_TRACK_IMAGE_DFLASH2` | `qwen3.8-27b-nvfp4-dflash2`, `ornith-1.5-122b-nvfp4`, both abliterated Qwen3.8 models, `lfm2.5-1.2b` | Upstream helper, compiles vLLM, over 40 minutes |
| `vllm-node-b12x` | `VLLM_TRACK_IMAGE_B12X` | `qwen3.8-flash-next-nvfp4`, `gemma4-26b-a4b`, `gemma4-31b` | Upstream helper, about 25 minutes with a cached FlashInfer wheel |
| `vllm-node-maya` | `VLLM_TRACK_IMAGE_MAYA` | `glm-5.3-flash-maya-s`, `glm-5.3-flash-maya-s-ablated` | One Dockerfile, about 15 minutes |

The upstream helper is [eugr/spark-vllm-docker](https://github.com/eugr/spark-vllm-docker),
pinned to a commit. The three vLLM builds need `docker login nvcr.io` first.

## `vllm-node-mxfp4`

From the repo root, after the tokenizer download in the [README](../README.md#2-download-the-gpt-oss-tokenizer-files):

```bash
docker build -t vllm-node-mxfp4 -f custom-docker-containers/vllm-node-mxfp4/Dockerfile .
```

## `vllm-node-dflash2` and `vllm-node-b12x`

Steps and pinned commits:

- [custom-docker-containers/vllm-node-dflash2/README.md](../custom-docker-containers/vllm-node-dflash2/README.md)
- [custom-docker-containers/vllm-node-b12x/README.md](../custom-docker-containers/vllm-node-b12x/README.md)

## `vllm-node-maya`

Not vLLM: [Project Maya](https://github.com/mw00/project-maya)'s engine and server, with the
dashboard, downloader, update check and MCP client removed. From the repo root:

```bash
docker compose --profile models build vllm-glm-5.3-flash-maya-s
```

Pins, build gates and the upgrade steps:
[custom-docker-containers/vllm-node-maya/README.md](../custom-docker-containers/vllm-node-maya/README.md).

## Memory

GPU and system RAM are one pool. The utility helper fits next to one main model; two main
models do not. When a large model dies during load, check memory headroom before the
image. `tools/run-model.sh` applies the waker's rules: it stops other main models, and stops
the utility helper for an exclusive model.

The Maya lane has no memory share. It takes what is available at its start, less its
`--ram-headroom-gb`.
