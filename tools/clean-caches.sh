#!/usr/bin/env bash
# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
# Clear lanes' compile, autotune and JIT caches now, for example when one may be corrupted or
# planted. The waker also clears a lane's caches before a start once they are older than
# CACHE_MAX_AGE_DAYS (default 14). A cleared lane rebuilds its caches on its next start, which
# takes a few minutes longer. Running lanes are skipped: stop them first.
#
#   bash tools/clean-caches.sh <model-id>...
#   bash tools/clean-caches.sh --all
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
require_cmd docker jq

usage() {
  echo "usage: clean-caches.sh <model-id>... | --all" >&2
  exit 2
}
[[ $# -ge 1 ]] || usage
if [[ "$1" == --all ]]; then
  mapfile -t MODEL_IDS < <(jq -r 'keys[]' "$MODELS_FILE")
else
  MODEL_IDS=("$@")
fi

# The waker mounts ./cache and runs as the user that owns the cache files.
if [[ "$(docker inspect -f '{{.State.Running}}' vllm-waker 2>/dev/null)" != true ]]; then
  echo "vllm-waker is not running; start the stack first" >&2
  exit 1
fi

for model_id in "${MODEL_IDS[@]}"; do
  container="$(jq -r --arg m "$model_id" '.[$m].container // empty' "$MODELS_FILE")"
  if [[ -z "$container" ]]; then
    echo "unknown model id: $model_id" >&2
    exit 2
  fi
  if [[ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null)" == true ]]; then
    echo "$model_id: $container is running; stop it first, skipped"
    continue
  fi
  docker exec vllm-waker node caches.js wipe "$container"
done
