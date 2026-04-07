#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

echo "Patching Qwen3/Coder-Next startup crash"
patch -p1 -N -d /usr/local/lib/python3.12/dist-packages < "$SCRIPT_DIR/fix_crash.diff" || \
  echo "Qwen3/Coder-Next crash patch is not applicable, continuing." >&2

echo "Reverting Qwen3/Coder-Next slowness regression"
patch -p1 -R -N -d /usr/local/lib/python3.12/dist-packages < "$SCRIPT_DIR/fix_slowness.diff" || \
  echo "Qwen3/Coder-Next slowness revert is not applicable, continuing." >&2

echo "Installing Triton allocator workaround"
cp "$SCRIPT_DIR/_triton_alloc_setup.pth" "$SCRIPT_DIR/_triton_alloc_setup.py" /usr/local/lib/python3.12/dist-packages/

exec "$@"