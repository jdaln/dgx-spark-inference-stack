#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

usage() {
  cat <<'EOF'
usage: inspect-model.sh [--compose-fragment PATH] <model-id|service|container>
EOF
}

TARGET=""
COMPOSE_FRAGMENT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --compose-fragment)
      COMPOSE_FRAGMENT="$2"
      shift 2
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

TMP_DIR="$(make_workspace_tmp_dir inspect-model)"
trap 'rm -rf "$TMP_DIR"' EXIT

COMPOSE_JSON="$TMP_DIR/compose.json"
if [[ -n "$COMPOSE_FRAGMENT" ]]; then
  render_fragment_compose_json "$COMPOSE_JSON" "$COMPOSE_FRAGMENT"
else
  render_active_compose_json "$COMPOSE_JSON"
fi

SERVICE_JSON="$(resolve_service_json "$COMPOSE_JSON" "$TARGET")"

MODEL_ID="$(jq -r '.modelId // ""' <<<"$SERVICE_JSON")"
SERVICE_NAME="$(jq -r '.serviceName' <<<"$SERVICE_JSON")"
CONTAINER_NAME="$(jq -r '.containerName' <<<"$SERVICE_JSON")"
SERVED_MODEL_NAME="$(jq -r '.servedModelName // ""' <<<"$SERVICE_JSON")"
IMAGE_NAME="$(jq -r '.image // "<none>"' <<<"$SERVICE_JSON")"
COMMAND_LINE="$(jq -r '.commandLine' <<<"$SERVICE_JSON")"
BUILD_CONTEXT="$(jq -r '.build.context // ""' <<<"$SERVICE_JSON")"
BUILD_DOCKERFILE="$(jq -r '.build.dockerfile // ""' <<<"$SERVICE_JSON")"

echo "Target: $TARGET"
if [[ -n "$MODEL_ID" ]]; then
  echo "Model id: $MODEL_ID"
fi
echo "Compose service: $SERVICE_NAME"
echo "Container: $CONTAINER_NAME"
if [[ -n "$SERVED_MODEL_NAME" ]]; then
  echo "Served model name: $SERVED_MODEL_NAME"
fi
echo "Image: $IMAGE_NAME"

if [[ -n "$BUILD_CONTEXT" || -n "$BUILD_DOCKERFILE" ]]; then
  echo
  echo "Build:"
  if [[ -n "$BUILD_CONTEXT" ]]; then
    echo "  context: $BUILD_CONTEXT"
  fi
  if [[ -n "$BUILD_DOCKERFILE" ]]; then
    echo "  dockerfile: $BUILD_DOCKERFILE"
  fi
  while IFS=$'\t' read -r key value; do
    [[ -n "$key" ]] || continue
    echo "  arg $key=$value"
  done < <(jq -r '.build.args // {} | to_entries | sort_by(.key)[] | [.key, .value] | @tsv' <<<"$SERVICE_JSON")
fi

echo
echo "Command:"
echo "  $COMMAND_LINE"

echo
echo "Environment:"
if jq -e '.environment | length > 0' <<<"$SERVICE_JSON" >/dev/null; then
  while IFS='=' read -r key value; do
    [[ -n "$key" ]] || continue
    echo "  $key=$(redact_secret "$key" "$value")"
  done < <(jq -r '.environment | to_entries | sort_by(.key)[] | "\(.key)=\(.value)"' <<<"$SERVICE_JSON")
else
  echo "  <none>"
fi

echo
echo "Bind mounts:"
if jq -e '.volumes | length > 0' <<<"$SERVICE_JSON" >/dev/null; then
  while IFS=$'\t' read -r source target mode; do
    [[ -n "$source" ]] || continue
    echo "  $source -> $target ($mode)"
  done < <(jq -r '.volumes[]? | select(.type == "bind") | [.source, .target, (if .read_only then "ro" else "rw" end)] | @tsv' <<<"$SERVICE_JSON")
else
  echo "  <none>"
fi

echo
echo "Local fix mounts:"
LOCAL_FIX_COUNT=0
while IFS=$'\t' read -r source target mode; do
  [[ -n "$source" ]] || continue
  case "$source" in
    "$REPO_DIR"/vllm_cache_huggingface|"$REPO_DIR"/models|"$REPO_DIR"/flashinfer_cache|"$REPO_DIR"/torch_extensions|"$REPO_DIR"/torchinductor|"$REPO_DIR"/stats)
      continue
      ;;
    "$REPO_DIR"/*)
      echo "  $source -> $target ($mode)"
      LOCAL_FIX_COUNT=$((LOCAL_FIX_COUNT + 1))
      ;;
  esac
done < <(jq -r '.volumes[]? | select(.type == "bind") | [.source, .target, (if .read_only then "ro" else "rw" end)] | @tsv' <<<"$SERVICE_JSON")
if [[ "$LOCAL_FIX_COUNT" -eq 0 ]]; then
  echo "  <none>"
fi

echo
echo "Healthcheck:"
if jq -e '.healthcheck != null' <<<"$SERVICE_JSON" >/dev/null; then
  echo "  test: $(jq -r '.healthcheck.test // [] | join(" ")' <<<"$SERVICE_JSON")"
  echo "  interval: $(jq -r '.healthcheck.interval // ""' <<<"$SERVICE_JSON")"
  echo "  timeout: $(jq -r '.healthcheck.timeout // ""' <<<"$SERVICE_JSON")"
  echo "  retries: $(jq -r '.healthcheck.retries // ""' <<<"$SERVICE_JSON")"
  echo "  start_period: $(jq -r '.healthcheck.start_period // ""' <<<"$SERVICE_JSON")"
else
  echo "  <none>"
fi