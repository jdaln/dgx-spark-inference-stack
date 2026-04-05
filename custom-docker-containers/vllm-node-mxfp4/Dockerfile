# syntax=docker/dockerfile:1.6

ARG BUILD_JOBS=16

FROM nvcr.io/nvidia/pytorch:26.01-py3 AS base

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

RUN --mount=type=cache,id=git-flashinfer,target=/git-cache/flashinfer \
    if [ -d /git-cache/flashinfer/.git ]; then \
        echo "=== Using cached FlashInfer repo ===" && \
        cp -a /git-cache/flashinfer /workspace/flashinfer && \
        cd /workspace/flashinfer && \
        git fetch origin && git fetch origin --tags; \
    else \
        echo "=== Cloning FlashInfer (first build) ===" && \
        git clone ${FLASHINFER_REPO} /workspace/flashinfer && \
        cp -a /workspace/flashinfer /git-cache/flashinfer; \
    fi && \
    cd /workspace/flashinfer && (git checkout --detach origin/${FLASHINFER_SHA} 2>/dev/null || git checkout ${FLASHINFER_SHA})

RUN cd /workspace/flashinfer && \
    git submodule update --init 3rdparty/spdlog

RUN --mount=type=cache,id=git-cutlass,target=/git-cache/cutlass \
    cd /workspace/flashinfer && \
    rm -rf 3rdparty/cutlass && \
    if [ -d /git-cache/cutlass/.git ] && [ -d /git-cache/cutlass/.git/objects ]; then \
        echo "=== Using cached CUTLASS repo ===" && \
        cp -a /git-cache/cutlass 3rdparty/cutlass && \
        cd 3rdparty/cutlass && \
        git fetch origin && git fetch origin --tags; \
    else \
        echo "=== Cloning CUTLASS (first build) ===" && \
        rm -rf /git-cache/cutlass/* /git-cache/cutlass/.* 2>/dev/null || true && \
        git clone ${CUTLASS_REPO} 3rdparty/cutlass && \
        cp -a /workspace/flashinfer/3rdparty/cutlass/. /git-cache/cutlass/; \
    fi && \
    cd /workspace/flashinfer/3rdparty/cutlass && (git checkout --detach origin/${CUTLASS_SHA} 2>/dev/null || git checkout ${CUTLASS_SHA})

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
ARG VLLM_REPO=https://github.com/christopherowen/vllm.git
ARG VLLM_SHA=045293d82b832229560ac4a13152a095af603b6e

RUN --mount=type=cache,id=repo-cache,target=/repo-cache \
    cd /repo-cache && \
    if [ ! -d "vllm-mxfp4" ]; then \
        echo "Cache miss: Cloning vLLM from scratch..." && \
        git clone --recursive ${VLLM_REPO} vllm-mxfp4 && \
        cd vllm-mxfp4 && \
        git checkout ${VLLM_SHA}; \
    else \
        echo "Cache hit: Fetching updates..." && \
        cd vllm-mxfp4 && \
        git fetch origin && \
        git fetch origin --tags && \
        (git checkout --detach origin/${VLLM_SHA} 2>/dev/null || git checkout ${VLLM_SHA}) && \
        git submodule update --init --recursive && \
        git clean -fdx && \
        git gc --auto; \
    fi && \
    mkdir $VLLM_BASE_DIR/vllm && \
    cp -a -r /repo-cache/vllm-mxfp4/. $VLLM_BASE_DIR/vllm/

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

FROM nvcr.io/nvidia/pytorch:26.01-py3 AS runner

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