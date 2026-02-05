#!/bin/bash
set -e
SCRIPT_DIR="$(dirname "$0")"

# Detect vLLM installation path
VLLM_PATH=$(python3 -c "import vllm, os; print(os.path.dirname(vllm.__file__))")
# We need to construct the full path to triton_mla.py relative to root
TARGET_REL_PATH="${VLLM_PATH#/}/v1/attention/backends/mla/triton_mla.py"

# Update patch file on the fly and apply it
sed "s|usr/local/lib/python3.12/dist-packages/vllm/v1/attention/backends/mla/triton_mla.py|$TARGET_REL_PATH|g" "$SCRIPT_DIR/glm47_flash.patch" | patch -p1 -d /
