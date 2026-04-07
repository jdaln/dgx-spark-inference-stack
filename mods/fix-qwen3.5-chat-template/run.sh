#!/bin/bash
set -euo pipefail

WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
CACHE_ROOT="${QWEN35_CHAT_TEMPLATE_CACHE_ROOT:-/models}"
DESTINATION="${QWEN35_CHAT_TEMPLATE_DESTINATION:-$WORKSPACE_DIR/unsloth.jinja}"
SOURCE_PATH="${QWEN35_CHAT_TEMPLATE_SOURCE:-}"

if [[ -z "$SOURCE_PATH" && -n "${QWEN35_CHAT_TEMPLATE_MODEL_ID:-}" ]]; then
  CACHE_KEY="${QWEN35_CHAT_TEMPLATE_MODEL_ID//\//--}"
  SNAPSHOT_ROOT="$CACHE_ROOT/models--${CACHE_KEY}/snapshots"

  shopt -s nullglob
  CANDIDATES=("$SNAPSHOT_ROOT"/*/chat_template.jinja)
  shopt -u nullglob

  if (( ${#CANDIDATES[@]} > 0 )); then
    SOURCE_PATH="${CANDIDATES[0]}"
  fi
fi

if [[ -z "$SOURCE_PATH" || ! -f "$SOURCE_PATH" ]]; then
  echo "Unable to locate a Qwen3.5 chat template. Set QWEN35_CHAT_TEMPLATE_SOURCE or QWEN35_CHAT_TEMPLATE_MODEL_ID." >&2
  exit 1
fi

mkdir -p "$(dirname -- "$DESTINATION")"
cp "$SOURCE_PATH" "$DESTINATION"

echo "Installed Qwen3.5 chat template at $DESTINATION from $SOURCE_PATH"

exec "$@"