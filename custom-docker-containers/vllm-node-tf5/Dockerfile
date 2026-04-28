ARG BASE_IMAGE=vllm-node-mxfp4
ARG VLLM_REPO=https://github.com/vllm-project/vllm.git
ARG VLLM_REF=50cd5674b
ARG TRANSFORMERS_VERSION=5.0.0rc1
ARG HUGGINGFACE_HUB_VERSION=1.3.2

ARG BASE_IMAGE
FROM ${BASE_IMAGE}

ARG VLLM_REPO
ARG VLLM_REF
ARG TRANSFORMERS_VERSION
ARG HUGGINGFACE_HUB_VERSION

LABEL ai.dgx.transformers_version=${TRANSFORMERS_VERSION} \
    ai.dgx.huggingface_hub_version=${HUGGINGFACE_HUB_VERSION}

RUN pip uninstall -y vllm flashinfer-python flashinfer-cubin flashinfer-jit-cache transformers huggingface_hub 2>/dev/null || true && \
    rm -rf /usr/local/lib/python3.12/dist-packages/transformers \
           /usr/local/lib/python3.12/dist-packages/transformers-*.dist-info \
           /usr/local/lib/python3.12/dist-packages/huggingface_hub \
           /usr/local/lib/python3.12/dist-packages/huggingface_hub-*.dist-info

RUN pip install --no-cache-dir --upgrade --pre --no-deps \
    "transformers==${TRANSFORMERS_VERSION}" \
    "huggingface_hub==${HUGGINGFACE_HUB_VERSION}"

COPY tmp/spark-vllm-docker/wheels /tmp/wheels
COPY custom-docker-containers/vllm-node-tf5/patch_cache_kernels.py /tmp/patch_cache_kernels.py

RUN pip install --no-deps /tmp/wheels/flashinfer_cubin-*.whl \
                         /tmp/wheels/flashinfer_jit_cache-*.whl \
                         /tmp/wheels/flashinfer_python-*.whl && \
    rm -rf /tmp/wheels

RUN rm -rf /tmp/vllm && \
    GIT_TERMINAL_PROMPT=0 git clone --filter=blob:none ${VLLM_REPO} /tmp/vllm && \
    cd /tmp/vllm && \
    git checkout ${VLLM_REF} && \
    git submodule update --init --recursive && \
    python3 /tmp/patch_cache_kernels.py /tmp/vllm && \
    python3 use_existing_torch.py && \
    uv pip install -r requirements/build.txt && \
    uv pip install --no-build-isolation --no-deps . && \
    uv pip install "instanttensor>=0.1.5"

RUN python3 - <<'PY'
from pathlib import Path


def replace_once(text: str, old: str, new: str) -> str:
    if old not in text:
        raise RuntimeError(f"Expected snippet not found: {old!r}")
    return text.replace(old, new, 1)


path = Path(
    "/usr/local/lib/python3.12/dist-packages/vllm/model_executor/layers/quantization/utils/w8a8_utils.py"
)
text = path.read_text()
text = replace_once(
    text,
    "    return ops.cutlass_scaled_mm_supports_fp8(capability)\n",
    "    if not hasattr(torch.ops._C, 'cutlass_scaled_mm_supports_fp8'):\n"
    "        return False\n\n"
    "    return ops.cutlass_scaled_mm_supports_fp8(capability)\n",
)
text = replace_once(
    text,
    "    return ops.cutlass_scaled_mm_supports_block_fp8(capability)\n",
    "    if not hasattr(torch.ops._C, 'cutlass_scaled_mm_supports_block_fp8'):\n"
    "        return False\n\n"
    "    return ops.cutlass_scaled_mm_supports_block_fp8(capability)\n",
)
text = replace_once(
    text,
    "    return ops.cutlass_group_gemm_supported(capability)\n",
    "    if not hasattr(torch.ops._C, 'cutlass_group_gemm_supported'):\n"
    "        return False\n\n"
    "    return ops.cutlass_group_gemm_supported(capability)\n",
)
path.write_text(text)

path = Path(
    "/usr/local/lib/python3.12/dist-packages/vllm/compilation/passes/fusion/matcher_utils.py"
)
text = path.read_text()
text = replace_once(
    text,
    "if current_platform.is_cuda():\n"
    "    QUANT_OPS[kFp8Dynamic128Sym] = torch.ops._C.per_token_group_fp8_quant.default  # noqa: E501\n"
    "    QUANT_OPS[kFp8Dynamic64Sym] = torch.ops._C.per_token_group_fp8_quant.default  # noqa: E501\n",
    "if current_platform.is_cuda() and hasattr(torch.ops._C, 'per_token_group_fp8_quant'):\n"
    "    QUANT_OPS[kFp8Dynamic128Sym] = torch.ops._C.per_token_group_fp8_quant.default  # noqa: E501\n"
    "    QUANT_OPS[kFp8Dynamic64Sym] = torch.ops._C.per_token_group_fp8_quant.default  # noqa: E501\n",
)
path.write_text(text)

path = Path(
    "/usr/local/lib/python3.12/dist-packages/vllm/compilation/passes/fusion/rms_quant_fusion.py"
)
text = path.read_text()
text = replace_once(
    text,
    "if current_platform.is_cuda():\n"
    "    QUANT_OPS[kFp8Dynamic128Sym] = torch.ops._C.per_token_group_fp8_quant.default  # noqa: E501\n"
    "    QUANT_OPS[kFp8Dynamic64Sym] = torch.ops._C.per_token_group_fp8_quant.default  # noqa: E501\n",
    "if current_platform.is_cuda() and hasattr(torch.ops._C, 'per_token_group_fp8_quant'):\n"
    "    QUANT_OPS[kFp8Dynamic128Sym] = torch.ops._C.per_token_group_fp8_quant.default  # noqa: E501\n"
    "    QUANT_OPS[kFp8Dynamic64Sym] = torch.ops._C.per_token_group_fp8_quant.default  # noqa: E501\n",
)
path.write_text(text)

path = Path(
    "/usr/local/lib/python3.12/dist-packages/vllm/model_executor/layers/quantization/utils/fp8_utils.py"
)
text = path.read_text()
text = replace_once(
    text,
    "    if current_platform.is_cuda() and x.is_contiguous():\n",
    "    if current_platform.is_cuda() and x.is_contiguous() and hasattr(torch.ops._C, 'per_token_group_fp8_quant'):\n",
)
path.write_text(text)
PY