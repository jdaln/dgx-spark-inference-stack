#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

usage() {
  cat <<'EOF'
usage: reload-control-plane.sh [--timeout SECONDS] [--stop-stale-utility]

Recreate waker and request-validator so they reload models.json.

Options:
  --timeout SECONDS       Max wait per control-plane container health check (default: 300)
  --stop-stale-utility    Stop the previously configured utility container if the utility mapping changed and that old container is still running
  -h, --help              Show this help
EOF
}

TIMEOUT_SECONDS=300
STOP_STALE_UTILITY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout)
      TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    --stop-stale-utility)
      STOP_STALE_UTILITY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_cmd docker jq

EXPECTED_UTILITY_CONTAINER="$(jq -r '[to_entries[] | select(.value.lifecycle == "utility") | .value.container][0] // ""' "$MODELS_FILE")"
PREVIOUS_UTILITY_CONTAINER=""

if container_is_running "vllm-waker"; then
  PREVIOUS_UTILITY_CONTAINER="$({ docker exec vllm-waker sh -lc 'wget -qO- http://127.0.0.1:18080/debug/state' 2>/dev/null || true; } | jq -r '.modelsConfig.utilityContainer // ""' 2>/dev/null || true)"
fi

echo "Expected utility container from models.json: ${EXPECTED_UTILITY_CONTAINER:-<none>}"
if [[ -n "$PREVIOUS_UTILITY_CONTAINER" ]]; then
  echo "Previously loaded utility container: $PREVIOUS_UTILITY_CONTAINER"
fi

docker compose -f "$ROOT_COMPOSE_FILE" up -d --no-deps --force-recreate waker request-validator >/dev/null

wait_for_container_health "vllm-waker" "$TIMEOUT_SECONDS"
wait_for_container_health "vllm-request-validator" "$TIMEOUT_SECONDS"

CURRENT_UTILITY_CONTAINER="$({ docker exec vllm-waker sh -lc 'wget -qO- http://127.0.0.1:18080/debug/state' 2>/dev/null || true; } | jq -r '.modelsConfig.utilityContainer // ""' 2>/dev/null || true)"

echo "Reloaded utility container: ${CURRENT_UTILITY_CONTAINER:-<none>}"

if [[ "$CURRENT_UTILITY_CONTAINER" != "$EXPECTED_UTILITY_CONTAINER" ]]; then
  echo "Reloaded control plane did not pick up the expected utility mapping" >&2
  exit 1
fi

if [[ -n "$PREVIOUS_UTILITY_CONTAINER" && "$PREVIOUS_UTILITY_CONTAINER" != "$CURRENT_UTILITY_CONTAINER" && $(container_is_running "$PREVIOUS_UTILITY_CONTAINER"; echo $?) -eq 0 ]]; then
  if [[ "$STOP_STALE_UTILITY" -eq 1 ]]; then
    echo "Stopping stale former utility container: $PREVIOUS_UTILITY_CONTAINER"
    docker stop "$PREVIOUS_UTILITY_CONTAINER" >/dev/null || true
  else
    echo "Note: stale former utility container is still running: $PREVIOUS_UTILITY_CONTAINER"
    echo "Run 'bash tools/reload-control-plane.sh --stop-stale-utility' if you want the helper to stop it for you."
  fi
fi

echo
echo "OK: waker and request-validator reloaded models.json"