# ============================================================================
# DGX Spark Optimized vLLM - Built from main branch
# Author: Thomas P. Braun (Avarok)
# Source: https://huggingface.co/Avarok/vllm-dgx-spark/tree/main
# Licence: Apache 2.0
# ============================================================================
# Purpose: Build vLLM from source to include non-gated activations support
#          for Nemotron3-Nano and other hybrid Mamba-Transformer models
#
# Key Features:
#   - vLLM built from main branch (includes PR #29004 for non-gated activations)
#   - CUDA 13.0 support for DGX Spark (GB10, compute capability 12.1)
#   - FlashInfer for optimized attention and MoE kernels
#   - Full CUDA graph support for hybrid models
#
# Usage:
#   docker run --gpus all --ipc=host -p 8000:8000 \
#     -e VLLM_FLASHINFER_MOE_BACKEND=latency \
#     vllm-dgx-spark:v11 \
#     serve <model> --quantization modelopt_fp4 --kv-cache-dtype fp8
# ============================================================================

FROM nvidia/cuda:13.0.2-cudnn-devel-ubuntu24.04

LABEL maintainer="avarok"
LABEL version="v11"
LABEL description="vLLM with non-gated activations support for Nemotron3-Nano on DGX Spark"

# Build arguments for cache busting and version pinning
ARG VLLM_COMMIT=main
ARG CACHEBUST_DEPS=1
ARG CACHEBUST_VLLM=1

# ============================================================================
# System Dependencies
# ============================================================================
RUN apt-get update && apt-get install -y \
    python3.12 python3.12-venv python3.12-dev python3-pip \
    git wget curl patch \
    cmake build-essential ninja-build \
    # InfiniBand/RDMA libraries for multi-node
    libibverbs1 libibverbs-dev ibverbs-providers rdma-core perftest \
    # Network utilities
    iproute2 iputils-ping net-tools openssh-client \
    && rm -rf /var/lib/apt/lists/*

# ============================================================================
# Python Virtual Environment
# ============================================================================
WORKDIR /workspace
RUN python3.12 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
ENV VIRTUAL_ENV="/opt/venv"

# Upgrade pip
RUN pip install --upgrade pip setuptools wheel

# ============================================================================
# PyTorch and Core Dependencies
# ============================================================================
ARG CACHEBUST_DEPS
# Install PyTorch with CUDA 13.0 support
RUN pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130

# Install xgrammar (structured output generation)
RUN pip install xgrammar

# Install FlashInfer (pre-release for CUDA 13.0 support)
RUN pip install flashinfer-python --pre

# IMPORTANT: Remove triton after installations as it causes CUDA 13.0 errors
# Both PyTorch and xgrammar pull it in as dependency
RUN pip uninstall -y triton || true && echo "Triton removed (if present)"

# ============================================================================
# Clone and Build vLLM from Source
# ============================================================================
ARG CACHEBUST_VLLM
ARG VLLM_COMMIT

WORKDIR /workspace/vllm
RUN git clone --recursive https://github.com/vllm-project/vllm.git . && \
    git checkout ${VLLM_COMMIT} && \
    echo "Building vLLM from commit: $(git rev-parse HEAD)"

# Prepare for existing torch installation
RUN python3 use_existing_torch.py

# Remove flashinfer from requirements (we installed it separately)
RUN sed -i "/flashinfer/d" requirements/cuda.txt || true
RUN sed -i '/^triton\b/d' requirements/test.txt || true

# Install build requirements
RUN pip install -r requirements/build.txt

# ============================================================================
# CMakeLists Patch for DGX Spark (GB10)
# ============================================================================
# This patch removes problematic SM12.x architectures from certain kernel
# compilations that cause issues on DGX Spark's GB10 GPU
COPY vllm_cmakelists.patch .
RUN patch -p1 < vllm_cmakelists.patch || echo "Patch may have already been applied or is not needed"

# ============================================================================
# Build Environment Variables
# ============================================================================
# GB10 compute capability 12.1 (Blackwell architecture)
# The 'f' suffix enables forward compatibility (PTX JIT for future architectures)
ENV TORCH_CUDA_ARCH_LIST="12.1f"
ENV CUDA_VISIBLE_ARCHITECTURES="12.1"

# Triton paths
ENV TRITON_PTXAS_PATH=/usr/local/cuda/bin/ptxas

# Note: Do NOT set TORCH_ALLOW_TF32_CUBLAS_OVERRIDE as it conflicts with PyTorch's new TF32 API
# TF32 is enabled by default on Ampere+ GPUs

# ============================================================================
# Build vLLM
# ============================================================================
RUN pip install --no-build-isolation . -v

# ============================================================================
# Clean up source directory to avoid import conflicts
# ============================================================================
# The source vllm/ directory must be removed or Python will import from it
# instead of the installed package (which has compiled _C extensions)
WORKDIR /workspace
RUN rm -rf /workspace/vllm

# ============================================================================
# Install Additional Runtime Dependencies
# ============================================================================
RUN pip install ray[default]

# ============================================================================
# Download Tiktoken Encodings
# ============================================================================
ENV TIKTOKEN_ENCODINGS_BASE=/workspace/tiktoken_encodings
RUN mkdir -p ${TIKTOKEN_ENCODINGS_BASE} && \
    wget -O ${TIKTOKEN_ENCODINGS_BASE}/o200k_base.tiktoken \
        "https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken" && \
    wget -O ${TIKTOKEN_ENCODINGS_BASE}/cl100k_base.tiktoken \
        "https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken"

# ============================================================================
# NCCL Configuration for InfiniBand/RoCE Multi-GPU
# ============================================================================
ENV NCCL_IB_DISABLE=0
ENV NCCL_DEBUG=WARN
ENV NCCL_NET_GDR_LEVEL=2
ENV NCCL_IB_TIMEOUT=23
ENV NCCL_IB_GID_INDEX=0
ENV NCCL_ASYNC_ERROR_HANDLING=1
ENV TORCH_NCCL_BLOCKING_WAIT=1

# ============================================================================
# vLLM V1 Engine and Optimization Settings
# ============================================================================
# Enable V1 engine for hybrid model support
ENV VLLM_USE_V1=1

# FlashInfer attention backend
ENV VLLM_ATTENTION_BACKEND=FLASHINFER

# CUDA graph mode for hybrid Mamba-Transformer models
ENV VLLM_CUDA_GRAPH_MODE=full_and_piecewise

# FlashInfer MoE for NVFP4 quantization (required for non-gated activations like ReLU²)
ENV VLLM_USE_FLASHINFER_MOE_FP4=1
# Note: Set VLLM_FLASHINFER_MOE_BACKEND=latency at runtime for SM12.1 compatibility
ENV VLLM_FLASHINFER_MOE_BACKEND=latency

# ============================================================================
# Finalize
# ============================================================================
WORKDIR /workspace

# Expose vLLM API port
EXPOSE 8000

# Default entrypoint
ENTRYPOINT ["vllm"]
CMD ["--help"]