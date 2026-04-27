ARG BASE_IMAGE=vllm-node-tf5

FROM ${BASE_IMAGE}

ARG TRANSFORMERS_UPSTREAM_REPO=https://github.com/huggingface/transformers.git
ARG TRANSFORMERS_UPSTREAM_SHA=eb981ae8688d459f40f35b0e0c352b5ca3cb3613
ARG HUGGINGFACE_HUB_VERSION=1.5.0

LABEL ai.dgx.transformers_upstream_repo=${TRANSFORMERS_UPSTREAM_REPO} \
    ai.dgx.transformers_upstream_sha=${TRANSFORMERS_UPSTREAM_SHA} \
    ai.dgx.huggingface_hub_version=${HUGGINGFACE_HUB_VERSION}

ENV DEBIAN_FRONTEND=noninteractive
ENV PIP_BREAK_SYSTEM_PACKAGES=1
ENV PIP_CACHE_DIR=/root/.cache/pip
ENV UV_CACHE_DIR=/root/.cache/uv
ENV UV_SYSTEM_PYTHON=1
ENV UV_BREAK_SYSTEM_PACKAGES=1
ENV UV_LINK_MODE=copy

RUN apt update && \
    apt install -y --no-install-recommends \
    git && \
    rm -rf /var/lib/apt/lists/* && \
    pip install uv

RUN retry() { \
        attempts=0; \
        until "$@"; do \
            attempts=$((attempts + 1)); \
            if [ "$attempts" -ge 3 ]; then \
                return 1; \
            fi; \
            sleep 5; \
        done; \
    }; \
    retry git clone ${TRANSFORMERS_UPSTREAM_REPO} /tmp/transformers-upstream && \
    cd /tmp/transformers-upstream && \
    git checkout --detach ${TRANSFORMERS_UPSTREAM_SHA}

RUN pip uninstall -y transformers huggingface_hub 2>/dev/null || true && \
    rm -rf /usr/local/lib/python3.12/dist-packages/transformers \
           /usr/local/lib/python3.12/dist-packages/transformers-*.dist-info \
           /usr/local/lib/python3.12/dist-packages/huggingface_hub \
           /usr/local/lib/python3.12/dist-packages/huggingface_hub-*.dist-info

RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    uv pip install "huggingface_hub==${HUGGINGFACE_HUB_VERSION}" && \
    uv pip install --no-build-isolation --no-deps /tmp/transformers-upstream

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
PY

RUN rm -rf /tmp/transformers-upstream

RUN python3 - <<'PY'
import importlib.util

import transformers
import vllm
from transformers import AutoConfig

assert importlib.util.find_spec("vllm._C") is not None
assert importlib.util.find_spec("vllm.model_executor.models.qwen3_5") is not None
assert importlib.util.find_spec("vllm.transformers_utils.configs.qwen3_5") is not None
assert importlib.util.find_spec("transformers.models.qwen3_5.configuration_qwen3_5") is not None

cfg = AutoConfig.from_pretrained(
    "huihui-ai/Huihui-Qwen3.6-27B-abliterated",
    trust_remote_code=True,
)
assert getattr(cfg, "model_type", None) == "qwen3_5"

print("vllm", vllm.__version__)
print("transformers", transformers.__version__)
print("architectures", getattr(cfg, "architectures", None))
PY