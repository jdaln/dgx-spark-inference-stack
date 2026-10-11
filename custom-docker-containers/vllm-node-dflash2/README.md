# `vllm-node-dflash2`

Image for `qwen3.8-27b-nvfp4-dflash2`, `huihui-qwen3.8-27b-abliterated`,
`huihui-qwen3.8-27b-abliterated-nvfp4` and the `lfm2.5-1.2b` utility helper.

The upstream helper [eugr/spark-vllm-docker](https://github.com/eugr/spark-vllm-docker) builds it
and compiles vLLM from source, so there is no Dockerfile here. This directory holds the
pinned upstream commit (`build-metadata.yaml`) and a local patch.

## Build

```bash
git clone https://github.com/eugr/spark-vllm-docker tmp/spark-vllm-docker 2>/dev/null || \
  git -C tmp/spark-vllm-docker fetch origin

git -C tmp/spark-vllm-docker checkout e9cf3596c4d8ecd677056b1d14eb5dda16c1f86e

bash custom-docker-containers/vllm-node-dflash2/fetch-tiktoken.sh tmp/spark-vllm-docker
git -C tmp/spark-vllm-docker apply \
  "$PWD/custom-docker-containers/vllm-node-dflash2/vendor-tiktoken.patch"

(cd tmp/spark-vllm-docker && bash build-and-copy.sh -t vllm-node-dflash2 --use-wheels)
```

Check that the build registers the draft architecture before you download 25.5 GB of
weights. This prints `True`:

```bash
docker run --rm --entrypoint python3 vllm-node-dflash2 -c \
  "from vllm.model_executor.models.registry import ModelRegistry as R; \
   print('DFlash2DraftModel' in R.get_supported_archs())"
```

## The patch

Upstream downloads two tiktoken encodings with `wget` about 40 minutes into the build, and
that download fails often. `fetch-tiktoken.sh` downloads them before the build, with
retries and sha256 checks, and the patch replaces the `wget` with a `COPY`. If upstream
starts shipping the encodings, drop the patch.
