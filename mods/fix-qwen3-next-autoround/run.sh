#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET_FILE="/usr/local/lib/python3.12/dist-packages/vllm/model_executor/models/qwen3_next.py"

HAS_PATCHED_GATE="$(python3 - "$TARGET_FILE" <<'PY'
from pathlib import Path
import sys

text = Path(sys.argv[1]).read_text()
patched = '''        self.gate = ReplicatedLinear(
            config.hidden_size,
            config.num_experts,
            bias=False,
            quant_config=quant_config,
            prefix=f"{prefix}.gate",
        )'''
legacy = '''        self.gate = ReplicatedLinear(
            config.hidden_size,
            config.num_experts,
            bias=False,
            quant_config=None,
            prefix=f"{prefix}.gate",
        )'''

if patched in text:
    print("patched")
elif legacy in text:
    print("legacy")
else:
    print("unknown")
PY
)"

if [[ "$HAS_PATCHED_GATE" == "patched" ]]; then
  echo "Qwen3-Coder-Next AutoRound gate quant fix already present, skipping patch." >&2
elif [[ "$HAS_PATCHED_GATE" == "legacy" ]]; then
  patch -p1 -N -d /usr/local/lib/python3.12/dist-packages < "$SCRIPT_DIR/vllm.patch" || \
    echo "Qwen3-Coder-Next AutoRound patch did not apply cleanly, continuing with the current vLLM build." >&2
else
  echo "Qwen3-Coder-Next AutoRound patch target did not match the expected qwen3_next gate pattern, continuing." >&2
fi

exec "$@"