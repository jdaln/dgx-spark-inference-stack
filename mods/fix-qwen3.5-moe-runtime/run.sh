#!/bin/bash
set -euo pipefail

bash /workspace/mods/fix-qwen3-coder-next/run.sh true

if [[ -n "${QWEN35_CHAT_TEMPLATE_MODEL_ID:-}" || -n "${QWEN35_CHAT_TEMPLATE_SOURCE:-}" ]]; then
  bash /workspace/mods/fix-qwen3.5-chat-template/run.sh true
fi

exec "$@"