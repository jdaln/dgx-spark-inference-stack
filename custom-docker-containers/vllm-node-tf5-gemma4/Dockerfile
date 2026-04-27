ARG BASE_IMAGE=vllm-node-tf5

FROM ${BASE_IMAGE}

ARG TRANSFORMERS_UPSTREAM_REPO=https://github.com/huggingface/transformers.git
ARG TRANSFORMERS_UPSTREAM_SHA=c472755e79aac54d675845bff5e5c821c21260af
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

RUN rm -rf /tmp/transformers-upstream

RUN python3 - <<'PY'
import importlib.util

import transformers

assert importlib.util.find_spec("transformers.models.gemma4") is not None
assert importlib.util.find_spec("transformers.models.gemma4.configuration_gemma4") is not None

print("transformers", transformers.__version__)
PY