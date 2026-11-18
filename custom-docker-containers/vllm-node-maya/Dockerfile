# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
#
# Project Maya's engine and its patched server for one hardened lane on a DGX Spark (aarch64,
# GB10, sm_121). Build context: custom-docker-containers/. README.md has the command.
#
# Upstream is not trusted. Pinned inputs are fetched first; every step that runs upstream code
# or builds from it has no network (RUN --network=none). The image is built only if the gates
# at the end pass.

ARG CUDA_DEVEL_IMAGE=nvidia/cuda:13.0.2-devel-ubuntu24.04@sha256:5dc1bca23d05bd37b011be68ec470c03b403a5da07ec3a86e41af9470e9d0cc6
ARG CUDA_RUNTIME_IMAGE=nvidia/cuda:13.0.2-runtime-ubuntu24.04@sha256:6a0e31b59e70890446f2c17356d6efc0d54260090a8c63d6ca7c2ad049db95d2
ARG MAYA_REPO=https://github.com/mw00/project-maya.git
ARG MAYA_SHA=f66a913c628c6672795088a56ad85de0efc827e4
ARG MAYA_VERSION=1.1.61
# The llama.cpp commit Maya itself pins (setup.py, third_party/ggml/VERSION.txt).
ARG LLAMA_CPP_REPO=https://github.com/ggml-org/llama.cpp.git
ARG LLAMA_CPP_SHA=3cf03257f219afbe7334045ff7c6a06ac68c627d
# nvcc takes 2-4 GB per job on the big kernels.
ARG BUILD_JOBS=8

# ---- source: the pinned commits (network) ----------------------------------------------------
FROM ${CUDA_DEVEL_IMAGE} AS source
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates cmake git ninja-build python3 \
    && rm -rf /var/lib/apt/lists/*
ARG MAYA_REPO
ARG MAYA_SHA
ARG LLAMA_CPP_REPO
ARG LLAMA_CPP_SHA
COPY --chmod=0755 vllm-node-mxfp4/fetch-pinned.sh /usr/local/bin/fetch-pinned
RUN --mount=type=cache,id=pinned-maya,target=/cache/pinned/maya \
    --mount=type=cache,id=pinned-llama-cpp,target=/cache/pinned/llama-cpp \
    fetch-pinned "$MAYA_REPO" "$MAYA_SHA" /src /cache/pinned/maya && \
    fetch-pinned "$LLAMA_CPP_REPO" "$LLAMA_CPP_SHA" /llama.cpp /cache/pinned/llama-cpp

# ---- build: patch and compile (no network) ---------------------------------------------------
FROM source AS build
ARG MAYA_VERSION
ARG LLAMA_CPP_SHA
ARG BUILD_JOBS
COPY vllm-node-maya/patches/ /lane/patches/
COPY vllm-node-maya/stubs/ /lane/stubs/
# Upstream's own pins must agree with ours. Then the lane's patches, with no fuzz: a patch that
# no longer applies stops the build. The stubs replace the update, download and MCP modules.
RUN --network=none set -eu; \
    test "$(cat /src/VERSION)" = "$MAYA_VERSION"; \
    grep -q "LLAMA_CPP_COMMIT = \"$LLAMA_CPP_SHA\"" /src/setup.py; \
    grep -q "$LLAMA_CPP_SHA" /src/third_party/ggml/VERSION.txt; \
    cd /src; \
    for p in /lane/patches/*.patch; do git apply --verbose "$p"; done; \
    for stub in /lane/stubs/*.py; do test -f "/src/serve/$(basename "$stub")"; cp "$stub" /src/serve/; done
# The engine for GLM-5.3-Flash only, for this GPU and CPU. Maya patches ggml's CUDA kernels at
# configure time and only warns when that fails; the engine built without the patch exits at
# run time, so the stamp it leaves is required here.
RUN --network=none set -eu; \
    cmake -S /src -B /build -G Ninja -DCMAKE_BUILD_TYPE=Release \
        -DSTRATA_ENABLE_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=121 \
        -DSTRATA_NATIVE_EXPERTS=ON -DSTRATA_BUILD_TESTS=OFF \
        -DSTRATA_GGML_DIR=/llama.cpp -DGGML_CPU_ARM_ARCH=armv8.6-a+dotprod+i8mm+fp16; \
    test -f /build/strata-ggml-cuda/.strata-stamp; \
    cmake --build /build --target maya -j "$BUILD_JOBS"
# What the lane runs, and nothing else: the patched server without its dashboard, tests and
# fake engines; the tool modules the server and the pack builder import; the expert profile;
# llama.cpp's gguf-py; the licence files.
RUN --network=none set -eu; \
    mkdir -p /out/maya/build /out/maya/tools /out/maya/data /out/maya/third_party/llama.cpp; \
    cp /build/maya /out/maya/build/maya; \
    cp -r /src/serve /out/maya/serve; \
    rm -rf /out/maya/serve/web /out/maya/serve/fixtures /out/maya/serve/__pycache__; \
    rm -f /out/maya/serve/test_*.py /out/maya/serve/*fake*.py; \
    for f in maya_names.py maya_quants.py strata_tokenizer.py gguf_reader.py _paths.py iq_pack.py; do \
        cp "/src/tools/$f" /out/maya/tools/; done; \
    cp /src/data/expert-profile-glm.bin /out/maya/data/; \
    cp -r /llama.cpp/gguf-py /out/maya/third_party/llama.cpp/gguf-py; \
    cp /llama.cpp/LICENSE /out/maya/third_party/llama.cpp/LICENSE; \
    cp /src/VERSION /src/LICENSE /out/maya/; \
    for d in ggml exllamav3 beellama.cpp; do \
        mkdir -p "/out/maya/third_party/$d"; cp /src/third_party/$d/LICENSE* "/out/maya/third_party/$d/"; done

# ---- python: the locked packages (network: PyPI, every file checked against its hash) ---------
FROM ${CUDA_RUNTIME_IMAGE} AS python
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY vllm-node-maya/requirements.lock /lane/requirements.lock
RUN python3 -m venv /opt/maya/.venv \
    && /opt/maya/.venv/bin/pip install --no-cache-dir --disable-pip-version-check \
         --require-hashes --only-binary :all: --no-deps -r /lane/requirements.lock \
    && /opt/maya/.venv/bin/pip freeze > /lane/pip-freeze.txt \
    && rm -rf /opt/maya/.venv/lib/python3*/site-packages/pip /opt/maya/.venv/lib/python3*/site-packages/pip-* \
              /opt/maya/.venv/bin/pip*

# ---- runtime: what ships ---------------------------------------------------------------------
FROM ${CUDA_RUNTIME_IMAGE} AS runtime
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 LANG=C.UTF-8 \
    MAYA_UPDATE_CHECK=0
RUN apt-get update && apt-get install -y --no-install-recommends curl python3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/maya /opt/maya
COPY --from=python /opt/maya/.venv /opt/maya/.venv
COPY --from=python /lane/pip-freeze.txt /opt/lane/pip-freeze.txt
COPY vllm-node-maya/maya_lane.py vllm-node-maya/build-metadata.yaml /opt/lane/
RUN printf '#!/bin/sh\nexec /opt/maya/.venv/bin/python -I /opt/lane/maya_lane.py serve "$@"\n' > /usr/local/bin/maya-lane \
    && printf '#!/bin/sh\nexec /opt/maya/.venv/bin/python -I /opt/lane/maya_lane.py pack "$@"\n' > /usr/local/bin/maya-lane-pack \
    && chmod 0755 /usr/local/bin/maya-lane /usr/local/bin/maya-lane-pack \
    && /opt/maya/.venv/bin/python -m compileall -q /opt/maya/serve /opt/maya/tools /opt/lane

# ---- gates: the image exists only if these pass (no network) ---------------------------------
FROM runtime AS gates
COPY vllm-node-maya/audit.py vllm-node-maya/audit-allow.txt vllm-node-maya/selftest.py \
     vllm-node-maya/test_maya_lane.py /opt/lane-tests/
# Maya's 12 MB synthetic model, for the pack builder check below. It carries no tokenizer, so
# the builder's last step fails on it, as in upstream's own image check: the index and the
# float weights are what is checked.
COPY --from=build /src/data/glm5-synth.gguf /opt/lane-tests/glm5-synth.gguf
RUN --network=none set -eu; \
    if ldd /opt/maya/build/maya | grep "not found"; then exit 1; fi; \
    /opt/maya/.venv/bin/python -I -B /opt/lane-tests/audit.py /opt/lane-tests/audit-allow.txt /opt/maya /opt/lane; \
    if /opt/maya/.venv/bin/python -I -c "import requests" 2>/dev/null; then \
        echo "the requests package is installed: audit-allow.txt relies on its absence"; exit 1; fi; \
    cp /opt/lane/maya_lane.py /opt/lane-tests/ && /opt/maya/.venv/bin/python -I -B /opt/lane-tests/test_maya_lane.py; \
    /opt/maya/.venv/bin/python -I -B /opt/lane-tests/selftest.py; \
    (/opt/maya/.venv/bin/python -I -B /opt/maya/tools/iq_pack.py --gguf /opt/lane-tests/glm5-synth.gguf \
        --out /tmp/synth-pack --compat-bf16 > /tmp/synth-pack.log 2>&1 || true); \
    if ! test -s /tmp/synth-pack/index.txt || ! test -s /tmp/synth-pack/dense.bin; then \
        tail -20 /tmp/synth-pack.log; echo "the pack builder does not work in the image"; exit 1; fi; \
    mkdir -p /out && date -u +%Y-%m-%dT%H:%M:%SZ > /out/gates-passed

FROM runtime
COPY --from=gates /out/gates-passed /opt/lane/gates-passed
WORKDIR /opt/maya
ENTRYPOINT []
CMD ["maya-lane", "--help"]
