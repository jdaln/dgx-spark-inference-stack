# `vllm-node-b12x`

Image for `qwen3.8-flash-next-nvfp4`, `gemma4-26b-a4b` and `gemma4-31b`. It is the
upstream helper's B12X build of the local-inference-lab vLLM and FlashInfer forks, which
carry GB10 kernels for FP4 MoE and linear layers and a disk-backed reader for
Flash-Next's 47 GB PLE n-gram table.

The helper compiles from source, so there is no Dockerfile here. This directory holds the
pinned commits (`build-metadata.yaml`), a build patch and the seccomp profile.

## Build

```bash
git clone https://github.com/eugr/spark-vllm-docker tmp/spark-vllm-docker 2>/dev/null || \
  git -C tmp/spark-vllm-docker fetch origin
git -C tmp/spark-vllm-docker worktree add --detach ../spark-vllm-docker-b12x a4c172976a5f9f8669b356a0891bf972cae14fd4

bash custom-docker-containers/vllm-node-dflash2/fetch-tiktoken.sh tmp/spark-vllm-docker-b12x
git -C tmp/spark-vllm-docker-b12x apply "$PWD/custom-docker-containers/vllm-node-b12x/b12x-build.patch"

# The Dockerfile names nvidia/cuda; use the nvcr.io copy under that name.
docker pull nvcr.io/nvidia/cuda:13.0.2-devel-ubuntu24.04
docker tag nvcr.io/nvidia/cuda:13.0.2-devel-ubuntu24.04 nvidia/cuda:13.0.2-devel-ubuntu24.04

(cd tmp/spark-vllm-docker-b12x && bash build-and-copy.sh -t vllm-node-b12x --exp-b12x \
  --rebuild-vllm --rebuild-flashinfer --flashinfer-ref 2f5210dd1566a8dfef754f68691b898b8d870244)
```

Keep the `--rebuild-*` flags: without them the helper pulls a prebuilt image. The build
takes about 25 minutes once the FlashInfer wheel is cached.

## Runtime requirements

- `qwen3.8-flash-next-nvfp4` reads its PLE table with io_uring, which Docker's default
  seccomp profile blocks. `seccomp-io-uring.json` is the default profile plus
  `io_uring_setup`, `io_uring_enter`, and `io_uring_register` for buffers and files only.
  The host must allow io_uring (`/proc/sys/kernel/io_uring_disabled` = 0). Keep the kernel
  patched: io_uring is a common source of kernel exploits. Details:
  [docs/security.md](../../docs/security.md#seccomp).
- The fork's Rust frontend is not built (`VLLM_REQUIRE_RUST_FRONTEND=0`). It is off by
  default and no lane uses it.

## Moving to upstream

The b12x kernels live in FlashInfer under `flashinfer/experimental/b12x`. As of 2026-10-09
no FlashInfer release ships them, and the pinned FlashInfer commit is ahead of
`flashinfer-ai/flashinfer` `main`. Once a release ships them and upstream vLLM uses it,
rebuild from release tags and rerun `tools/bench-lane.mjs`, the 240k soak and
`tools/smoke-gateway.sh`.
