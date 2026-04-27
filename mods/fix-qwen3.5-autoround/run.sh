#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET_FILE="/usr/local/lib/python3.12/dist-packages/transformers/modeling_rope_utils.py"

if grep -Fq 'set(ignore_keys_at_rope_validation) | {"partial_rotary_factor"}' "$TARGET_FILE"; then
  echo "Qwen3.5 AutoRound rope fix already present, skipping patch." >&2
elif ! patch -p1 -N -d /usr/local/lib/python3.12/dist-packages < "$SCRIPT_DIR/transformers.patch"; then
  echo "Qwen3.5 AutoRound patch did not apply cleanly, continuing with the current transformers build." >&2
fi

exec "$@"