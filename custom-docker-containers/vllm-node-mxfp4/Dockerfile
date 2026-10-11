# syntax=docker/dockerfile:1.6

ARG BUILD_JOBS=16

FROM nvcr.io/nvidia/pytorch:26.01-py3@sha256:1b6dd8dc60741fb99b9aa343fa03fc897fbb64fbdcb1c8afcbd48c75cba57255 AS base

ARG BUILD_JOBS
ENV MAX_JOBS=${BUILD_JOBS}
ENV CMAKE_BUILD_PARALLEL_LEVEL=${BUILD_JOBS}
ENV NINJAFLAGS="-j${BUILD_JOBS}"
ENV MAKEFLAGS="-j${BUILD_JOBS}"
ENV DEBIAN_FRONTEND=noninteractive
ENV PIP_BREAK_SYSTEM_PACKAGES=1
ENV PIP_CACHE_DIR=/root/.cache/pip
ENV UV_CACHE_DIR=/root/.cache/uv
ENV UV_SYSTEM_PYTHON=1
ENV UV_BREAK_SYSTEM_PACKAGES=1
ENV UV_LINK_MODE=copy
ENV VLLM_BASE_DIR=/workspace/vllm
ENV PATH=/usr/lib/ccache:$PATH
ENV CCACHE_DIR=/root/.ccache
ENV CCACHE_MAXSIZE=50G
ENV CCACHE_COMPRESS=1
ENV CMAKE_CXX_COMPILER_LAUNCHER=ccache
ENV CMAKE_CUDA_COMPILER_LAUNCHER=ccache

RUN apt update && \
    apt install -y --no-install-recommends \
    curl vim ninja-build git ccache && \
    rm -rf /var/lib/apt/lists/* && \
    pip install uv && pip uninstall -y flash-attn

WORKDIR $VLLM_BASE_DIR

ARG TORCH_CUDA_ARCH_LIST="12.1a"
ENV TORCH_CUDA_ARCH_LIST=${TORCH_CUDA_ARCH_LIST}
ENV TRITON_PTXAS_PATH=/usr/local/cuda/bin/ptxas

ARG CACHEBUST_DEPS=1

RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    uv pip install fastsafetensors

ARG PRE_TRANSFORMERS=0
RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    if [ "$PRE_TRANSFORMERS" = "1" ]; then \
        uv pip install -U transformers --pre; \
    fi

FROM base AS builder

ARG FLASHINFER_CUDA_ARCH_LIST="12.1a"
ENV FLASHINFER_CUDA_ARCH_LIST=${FLASHINFER_CUDA_ARCH_LIST}

WORKDIR $VLLM_BASE_DIR

ARG FLASHINFER_REPO=https://github.com/christopherowen/flashinfer.git
ARG CUTLASS_REPO=https://github.com/christopherowen/cutlass.git
ARG FLASHINFER_SHA=f349e52496a72a00d8c4ac02c7a1e38523ff7194
ARG CUTLASS_SHA=fede53000a962b46e05bafe0c86311778caeb380

RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    uv pip install "nvidia-nvshmem-cu13<3.6" "apache-tvm-ffi<0.2"

COPY --chmod=0755 custom-docker-containers/vllm-node-mxfp4/fetch-pinned.sh /usr/local/bin/fetch-pinned

# CUTLASS comes from the MXFP4 fork, not from FlashInfer's own submodule pin.
RUN --mount=type=cache,id=pinned-flashinfer,target=/cache/pinned/flashinfer \
    --mount=type=cache,id=pinned-spdlog,target=/cache/pinned/spdlog \
    --mount=type=cache,id=pinned-cutlass,target=/cache/pinned/cutlass \
    fetch-pinned "$FLASHINFER_REPO" "$FLASHINFER_SHA" /workspace/flashinfer /cache/pinned/flashinfer && \
    cd /workspace/flashinfer && \
    fetch-pinned "$(git config -f .gitmodules --get submodule.3rdparty/spdlog.url)" \
        "$(git rev-parse HEAD:3rdparty/spdlog)" 3rdparty/spdlog /cache/pinned/spdlog && \
    fetch-pinned "$CUTLASS_REPO" "$CUTLASS_SHA" 3rdparty/cutlass /cache/pinned/cutlass

WORKDIR /workspace/flashinfer

RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    --mount=type=cache,id=ccache,target=/root/.ccache \
    sed -i -e 's/license = "Apache-2.0"/license = { text = "Apache-2.0" }/' -e '/license-files/d' pyproject.toml && \
    uv build --no-build-isolation --wheel . --out-dir=/workspace/wheels -v

RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    --mount=type=cache,id=ccache,target=/root/.ccache \
    cd flashinfer-cubin && uv build --no-build-isolation --wheel . --out-dir=/workspace/wheels -v

RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    --mount=type=cache,id=ccache,target=/root/.ccache \
    cd flashinfer-jit-cache && \
    uv build --no-build-isolation --wheel . --out-dir=/workspace/wheels -v

ARG CACHEBUST_VLLM=1
# Christopher Owen's MXFP4 fork of vLLM, not upstream.
ARG VLLM_REPO=https://github.com/christopherowen/vllm.git
ARG VLLM_SHA=045293d82b832229560ac4a13152a095af603b6e

RUN --mount=type=cache,id=pinned-vllm-mxfp4,target=/cache/pinned/vllm \
    fetch-pinned "$VLLM_REPO" "$VLLM_SHA" "$VLLM_BASE_DIR/vllm" /cache/pinned/vllm submodules

WORKDIR $VLLM_BASE_DIR/vllm

ARG PRE_TRANSFORMERS=0

RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    python3 use_existing_torch.py && \
    sed -i "/flashinfer/d" requirements/cuda.txt && \
    sed -i '/^fastsafetensors\b/d' requirements/test.txt && \
    if [ "$PRE_TRANSFORMERS" = "1" ]; then \
        sed -i '/^transformers\b/d' requirements/common.txt; \
        sed -i '/^transformers\b/d' requirements/test.txt; \
    fi && \
    uv pip install -r requirements/build.txt

COPY custom-docker-containers/vllm-node-mxfp4/fastsafetensors_mxfp4.patch .
RUN patch -p1 < fastsafetensors_mxfp4.patch

RUN --mount=type=cache,id=ccache,target=/root/.ccache \
    --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    uv build --no-build-isolation --wheel . --out-dir=/workspace/wheels -v

FROM nvcr.io/nvidia/pytorch:26.01-py3@sha256:1b6dd8dc60741fb99b9aa343fa03fc897fbb64fbdcb1c8afcbd48c75cba57255 AS runner

ENV DEBIAN_FRONTEND=noninteractive
ENV PIP_BREAK_SYSTEM_PACKAGES=1
ENV VLLM_BASE_DIR=/workspace/vllm
ENV PIP_CACHE_DIR=/root/.cache/pip
ENV UV_CACHE_DIR=/root/.cache/uv
ENV UV_SYSTEM_PYTHON=1
ENV UV_BREAK_SYSTEM_PACKAGES=1
ENV UV_LINK_MODE=copy

RUN apt update && \
    apt install -y --no-install-recommends \
    curl vim git libxcb1 && \
    rm -rf /var/lib/apt/lists/* && \
    pip install uv && pip uninstall -y flash-attn

WORKDIR $VLLM_BASE_DIR

COPY manual_download/openai_gpt-oss-encodings_fix ./tiktoken_encodings

RUN --mount=type=bind,from=builder,source=/workspace/wheels,target=/mount/wheels \
    --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    uv pip install /mount/wheels/*.whl

ARG TORCH_CUDA_ARCH_LIST="12.1a"
ENV TORCH_CUDA_ARCH_LIST=${TORCH_CUDA_ARCH_LIST}
ARG FLASHINFER_CUDA_ARCH_LIST="12.1a"
ENV FLASHINFER_CUDA_ARCH_LIST=${FLASHINFER_CUDA_ARCH_LIST}
ENV TRITON_PTXAS_PATH=/usr/local/cuda/bin/ptxas
ENV TIKTOKEN_ENCODINGS_BASE=$VLLM_BASE_DIR/tiktoken_encodings
ENV PATH=$VLLM_BASE_DIR:$PATH

RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    uv pip install ray[default] fastsafetensors "nvidia-nvshmem-cu13<3.6"

COPY custom-docker-containers/vllm-node-mxfp4/build-metadata.yaml /workspace/build-metadata.yaml

RUN uv pip uninstall triton-kernels