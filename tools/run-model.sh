#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

usage() {
  cat <<'EOF'
usage: run-model.sh [--timeout SECONDS] [--no-build] <model-id|service|container>
EOF
}

TARGET=""
TIMEOUT_SECONDS=1800
BUILD_ENABLED=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout)
      TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    --no-build)
      BUILD_ENABLED=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -n "$TARGET" ]]; then
        echo "Unexpected extra argument: $1" >&2
        usage >&2
        exit 1
      fi
      TARGET="$1"
      shift
      ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  usage >&2
  exit 1
fi

require_cmd docker jq node

TMP_DIR="$(make_workspace_tmp_dir run-model)"
trap 'rm -rf "$TMP_DIR"' EXIT

COMPOSE_JSON="$TMP_DIR/compose.json"
render_active_compose_json "$COMPOSE_JSON"
SERVICE_JSON="$(resolve_service_json "$COMPOSE_JSON" "$TARGET")"

MODEL_ID="$(jq -r '.modelId // ""' <<<"$SERVICE_JSON")"
SERVICE_NAME="$(jq -r '.serviceName' <<<"$SERVICE_JSON")"
CONTAINER_NAME="$(jq -r '.containerName' <<<"$SERVICE_JSON")"
MODEL_LIFECYCLE=""
UTILITY_CONTAINER=""

if [[ -n "$MODEL_ID" ]]; then
  MODEL_LIFECYCLE="$(jq -r --arg model "$MODEL_ID" '.[$model].lifecycle // ""' "$MODELS_FILE")"
fi

UTILITY_CONTAINER="$(jq -r '[to_entries[] | select(.value.lifecycle == "utility") | .value.container][0] // ""' "$MODELS_FILE")"

echo "Model under test: ${MODEL_ID:-<unmapped>}"
echo "Compose service: $SERVICE_NAME"
echo "Container: $CONTAINER_NAME"

mapfile -t RUNNING_MAIN_MODEL_CONTAINERS < <(
  jq -r --arg target "$CONTAINER_NAME" --arg utility "$UTILITY_CONTAINER" --arg target_lifecycle "$MODEL_LIFECYCLE" '
    to_entries[]
    | select(.value.container != $target)
    | select($target_lifecycle != "utility")
    | select(.value.lifecycle != "utility")
    | select(.value.container != $utility)
    | .value.container
  ' "$MODELS_FILE" | while IFS= read -r other_container; do
    if container_is_running "$other_container"; then
      printf '%s\n' "$other_container"
    fi
  done
)

if [[ "${#RUNNING_MAIN_MODEL_CONTAINERS[@]}" -gt 0 ]]; then
  echo "Single-tenant test run; stopping other managed model containers first:"
  printf '  %s\n' "${RUNNING_MAIN_MODEL_CONTAINERS[@]}"
  docker stop "${RUNNING_MAIN_MODEL_CONTAINERS[@]}" >/dev/null
fi

if [[ "$MODEL_LIFECYCLE" == "exclusive" && -n "$UTILITY_CONTAINER" ]]; then
  if container_is_running "$UTILITY_CONTAINER"; then
    echo "Exclusive model requested; stopping utility container first:"
    printf '  %s\n' "$UTILITY_CONTAINER"
    docker stop "$UTILITY_CONTAINER" >/dev/null
  fi
fi

if [[ "$MODEL_LIFECYCLE" == "utility" ]]; then
  mapfile -t RUNNING_EXCLUSIVE_CONTAINERS < <(
    jq -r --arg target "$CONTAINER_NAME" '
      to_entries[]
      | select(.value.container != $target)
      | select(.value.lifecycle == "exclusive")
      | .value.container
    ' "$MODELS_FILE" | while IFS= read -r other_container; do
      if container_is_running "$other_container"; then
        printf '%s\n' "$other_container"
      fi
    done
  )

  if [[ "${#RUNNING_EXCLUSIVE_CONTAINERS[@]}" -gt 0 ]]; then
    echo "Utility model requested; stopping running exclusive model containers first:"
    printf '  %s\n' "${RUNNING_EXCLUSIVE_CONTAINERS[@]}"
    docker stop "${RUNNING_EXCLUSIVE_CONTAINERS[@]}" >/dev/null
  fi
fi

COMPOSE_ARGS=(docker compose --profile models -f "$ROOT_COMPOSE_FILE" up -d --no-deps --force-recreate)
if [[ "$BUILD_ENABLED" -eq 1 ]]; then
  COMPOSE_ARGS+=(--build)
fi
COMPOSE_ARGS+=("$SERVICE_NAME")

"${COMPOSE_ARGS[@]}"

wait_for_container_health "$CONTAINER_NAME" "$TIMEOUT_SECONDS"

echo
echo "OK: $CONTAINER_NAME is healthy"