ARG BASE_IMAGE=vllm-node-mxfp4
ARG VLLM_REPO=https://github.com/vllm-project/vllm.git
ARG VLLM_REF=50cd5674b

FROM avarok/vllm-dgx-spark:v11-tf5 AS tf5_source

ARG BASE_IMAGE
FROM ${BASE_IMAGE}

ARG VLLM_REPO
ARG VLLM_REF

RUN pip uninstall -y vllm flashinfer-python flashinfer-cubin flashinfer-jit-cache transformers huggingface_hub 2>/dev/null || true && \
    rm -rf /usr/local/lib/python3.12/dist-packages/transformers \
           /usr/local/lib/python3.12/dist-packages/transformers-*.dist-info \
           /usr/local/lib/python3.12/dist-packages/huggingface_hub \
           /usr/local/lib/python3.12/dist-packages/huggingface_hub-*.dist-info

COPY --from=tf5_source /opt/venv/lib/python3.12/site-packages/transformers /usr/local/lib/python3.12/dist-packages/transformers
COPY --from=tf5_source /opt/venv/lib/python3.12/site-packages/transformers-5.0.0rc1.dist-info /usr/local/lib/python3.12/dist-packages/transformers-5.0.0rc1.dist-info
COPY --from=tf5_source /opt/venv/lib/python3.12/site-packages/huggingface_hub /usr/local/lib/python3.12/dist-packages/huggingface_hub
COPY --from=tf5_source /opt/venv/lib/python3.12/site-packages/huggingface_hub-1.3.2.dist-info /usr/local/lib/python3.12/dist-packages/huggingface_hub-1.3.2.dist-info

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