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

RUN --mount=type=cache,id=git-flashinfer,target=/git-cache/flashinfer \
    --mount=type=cache,id=git-flashinfer-spdlog,target=/git-cache/flashinfer-spdlog \
    retry() { \
        attempts=0; \
        until "$@"; do \
            attempts=$((attempts + 1)); \
            if [ "$attempts" -ge 3 ]; then \
                return 1; \
            fi; \
            sleep 5; \
        done; \
    }; \
    reset_cache_dir() { \
        mkdir -p "$1"; \
        find "$1" -mindepth 1 -maxdepth 1 -exec rm -rf {} +; \
    }; \
    if [ -d /git-cache/flashinfer/.git ] && [ -d /git-cache/flashinfer/.git/objects ]; then \
        echo "=== Using cached FlashInfer repo ===" && \
        rm -rf /workspace/flashinfer && \
        mkdir -p /workspace/flashinfer && \
        cp -a /git-cache/flashinfer/. /workspace/flashinfer/ && \
        cd /workspace/flashinfer && \
        if ! retry git fetch origin; then \
            echo "WARN: FlashInfer fetch failed, continuing with cached repo" >&2; \
        fi && \
        if ! retry git fetch origin --tags; then \
            echo "WARN: FlashInfer tag fetch failed, continuing with cached repo" >&2; \
        fi; \
    else \
        echo "=== Cloning FlashInfer (first build) ===" && \
        retry git clone ${FLASHINFER_REPO} /workspace/flashinfer; \
    fi && \
    cd /workspace/flashinfer && \
    (git checkout --detach origin/${FLASHINFER_SHA} 2>/dev/null || git checkout ${FLASHINFER_SHA}) && \
    reset_cache_dir /git-cache/flashinfer && \
    cp -a /workspace/flashinfer/. /git-cache/flashinfer/ && \
    SPDLOG_REPO=$(git config -f .gitmodules --get 'submodule.3rdparty/spdlog.url') && \
    SPDLOG_SHA=$(git ls-tree HEAD 3rdparty/spdlog | awk '{print $3}') && \
    if [ -z "$SPDLOG_REPO" ] || [ -z "$SPDLOG_SHA" ]; then \
        echo "Unable to resolve spdlog submodule metadata" >&2; \
        exit 1; \
    fi && \
    mkdir -p /workspace/flashinfer/3rdparty && \
    if [ -d /git-cache/flashinfer-spdlog/.git ] && [ -d /git-cache/flashinfer-spdlog/.git/objects ]; then \
        echo "=== Using cached spdlog repo ===" && \
        rm -rf /workspace/flashinfer/3rdparty/spdlog && \
        mkdir -p /workspace/flashinfer/3rdparty/spdlog && \
        cp -a /git-cache/flashinfer-spdlog/. /workspace/flashinfer/3rdparty/spdlog/ && \
        cd /workspace/flashinfer/3rdparty/spdlog && \
        if ! retry git fetch origin; then \
            echo "WARN: spdlog fetch failed, continuing with cached repo" >&2; \
        fi && \
        if ! retry git fetch origin --tags; then \
            echo "WARN: spdlog tag fetch failed, continuing with cached repo" >&2; \
        fi; \
    else \
        echo "=== Cloning spdlog (first build) ===" && \
        retry git clone ${SPDLOG_REPO} /workspace/flashinfer/3rdparty/spdlog; \
    fi && \
    cd /workspace/flashinfer/3rdparty/spdlog && \
    (git checkout --detach origin/${SPDLOG_SHA} 2>/dev/null || git checkout ${SPDLOG_SHA}) && \
    reset_cache_dir /git-cache/flashinfer-spdlog && \
    cp -a /workspace/flashinfer/3rdparty/spdlog/. /git-cache/flashinfer-spdlog/

RUN --mount=type=cache,id=git-cutlass,target=/git-cache/cutlass \
    retry() { \
        attempts=0; \
        until "$@"; do \
            attempts=$((attempts + 1)); \
            if [ "$attempts" -ge 3 ]; then \
                return 1; \
            fi; \
            sleep 5; \
        done; \
    }; \
    reset_cache_dir() { \
        mkdir -p "$1"; \
        find "$1" -mindepth 1 -maxdepth 1 -exec rm -rf {} +; \
    }; \
    cd /workspace/flashinfer && \
    rm -rf 3rdparty/cutlass && \
    mkdir -p 3rdparty/cutlass && \
    if [ -d /git-cache/cutlass/.git ] && [ -d /git-cache/cutlass/.git/objects ]; then \
        echo "=== Using cached CUTLASS repo ===" && \
        cp -a /git-cache/cutlass/. 3rdparty/cutlass/ && \
        cd 3rdparty/cutlass && \
        if ! retry git fetch origin; then \
            echo "WARN: CUTLASS fetch failed, continuing with cached repo" >&2; \
        fi && \
        if ! retry git fetch origin --tags; then \
            echo "WARN: CUTLASS tag fetch failed, continuing with cached repo" >&2; \
        fi; \
    else \
        echo "=== Cloning CUTLASS (first build) ===" && \
        retry git clone ${CUTLASS_REPO} 3rdparty/cutlass; \
    fi && \
    cd /workspace/flashinfer/3rdparty/cutlass && \
    (git checkout --detach origin/${CUTLASS_SHA} 2>/dev/null || git checkout ${CUTLASS_SHA}) && \
    reset_cache_dir /git-cache/cutlass && \
    cp -a /workspace/flashinfer/3rdparty/cutlass/. /git-cache/cutlass/

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
# That line still pins Christopher Owen's MXFP4 fork rather than the standard upstream vLLM repo.
ARG VLLM_REPO=https://github.com/christopherowen/vllm.git
ARG VLLM_SHA=045293d82b832229560ac4a13152a095af603b6e

RUN --mount=type=cache,id=git-vllm-mxfp4,target=/git-cache/vllm-mxfp4 \
    retry() { \
        attempts=0; \
        until "$@"; do \
            attempts=$((attempts + 1)); \
            if [ "$attempts" -ge 3 ]; then \
                return 1; \
            fi; \
            sleep 5; \
        done; \
    }; \
    reset_cache_dir() { \
        mkdir -p "$1"; \
        find "$1" -mindepth 1 -maxdepth 1 -exec rm -rf {} +; \
    }; \
    if [ -d /git-cache/vllm-mxfp4/.git ] && [ -d /git-cache/vllm-mxfp4/.git/objects ]; then \
        echo "=== Using cached vLLM repo ===" && \
        rm -rf $VLLM_BASE_DIR/vllm && \
        mkdir -p $VLLM_BASE_DIR/vllm && \
        cp -a /git-cache/vllm-mxfp4/. $VLLM_BASE_DIR/vllm/ && \
        cd $VLLM_BASE_DIR/vllm && \
        if ! retry git fetch origin; then \
            echo "WARN: vLLM fetch failed, continuing with cached repo" >&2; \
        fi && \
        if ! retry git fetch origin --tags; then \
            echo "WARN: vLLM tag fetch failed, continuing with cached repo" >&2; \
        fi; \
    else \
        echo "Cache miss: Cloning vLLM from scratch..." && \
        rm -rf $VLLM_BASE_DIR/vllm && \
        retry git clone ${VLLM_REPO} $VLLM_BASE_DIR/vllm; \
    fi && \
    cd $VLLM_BASE_DIR/vllm && \
    (git checkout --detach origin/${VLLM_SHA} 2>/dev/null || git checkout ${VLLM_SHA}) && \
    if ! retry git submodule sync --recursive; then \
        echo "WARN: vLLM submodule sync failed, continuing with existing config" >&2; \
    fi && \
    retry git submodule update --init --recursive && \
    git clean -fdx && \
    git gc --auto && \
    reset_cache_dir /git-cache/vllm-mxfp4 && \
    cp -a $VLLM_BASE_DIR/vllm/. /git-cache/vllm-mxfp4/

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