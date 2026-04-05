#!/usr/bin/env bash

COMMON_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_DIR="$(cd -- "$COMMON_DIR/.." && pwd)"
REPO_DIR="$(cd -- "$TOOLS_DIR/.." && pwd)"
MODELS_FILE="${MODELS_FILE:-$REPO_DIR/models.json}"
ROOT_COMPOSE_FILE="${ROOT_COMPOSE_FILE:-$REPO_DIR/docker-compose.yml}"
DEFAULT_API_KEY="${DEFAULT_API_KEY:-63TestTOKEN0REPLACEME}"
WORKSPACE_TMP_DIR="${WORKSPACE_TMP_DIR:-$REPO_DIR/tmp}"

ensure_workspace_tmp_dir() {
  mkdir -p "$WORKSPACE_TMP_DIR"
}

make_workspace_tmp_dir() {
  local prefix="${1:-workspace-tmp}"

  ensure_workspace_tmp_dir
  mktemp -d "$WORKSPACE_TMP_DIR/${prefix}.XXXXXX"
}

require_cmd() {
  local missing=0
  local cmd

  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "Missing required command: $cmd" >&2
      missing=1
    fi
  done

  return "$missing"
}

render_active_compose_json() {
  local output_path="$1"

  docker compose --profile models -f "$ROOT_COMPOSE_FILE" config --format json > "$output_path"
}

render_fragment_compose_json() {
  local output_path="$1"
  local fragment_path="$2"
  local fragment_dir
  local stub_path

  if [[ "$fragment_path" != /* ]]; then
    fragment_path="$REPO_DIR/$fragment_path"
  fi

  if [[ ! -f "$fragment_path" ]]; then
    echo "Missing compose fragment: $fragment_path" >&2
    return 1
  fi

  fragment_dir="$(cd -- "$(dirname -- "$fragment_path")" && pwd)"
  stub_path="$fragment_dir/.compose-validation-base.$$.$RANDOM.yml"

  cat > "$stub_path" <<'EOF'
networks:
  default: {}
  vllm_internal:
    internal: true
EOF

  docker compose --profile models -f "$stub_path" -f "$fragment_path" config --format json > "$output_path"
  rm -f "$stub_path"
}

resolve_service_json() {
  local compose_json_path="$1"
  local target="$2"

  node "$TOOLS_DIR/lib/resolve-compose-service.mjs" "$compose_json_path" "$MODELS_FILE" "$target"
}

redact_secret() {
  local key="$1"
  local value="$2"
  local upper_key="${key^^}"

  case "$upper_key" in
    *TOKEN*|*KEY*|*SECRET*|*PASSWORD*)
      if [[ -n "$value" ]]; then
        printf '<redacted:%s chars>' "${#value}"
      else
        printf '<redacted>'
      fi
      ;;
    *)
      printf '%s' "$value"
      ;;
  esac
}

wait_for_container_health() {
  local container_name="$1"
  local timeout_seconds="${2:-900}"
  local deadline
  local status

  deadline=$(( $(date +%s) + timeout_seconds ))

  while (( $(date +%s) < deadline )); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name" 2>/dev/null || true)"

    case "$status" in
      healthy|running)
        return 0
        ;;
      exited|dead)
        echo "Container $container_name is $status" >&2
        return 1
        ;;
      unhealthy)
        echo "Container $container_name is unhealthy" >&2
        return 1
        ;;
    esac

    sleep 2
  done

  echo "Timed out waiting for $container_name to become healthy" >&2
  return 1
}

container_is_running() {
  local container_name="$1"
  local running

  running="$(docker inspect --format '{{.State.Running}}' "$container_name" 2>/dev/null || true)"
  [[ "$running" == "true" ]]
}

infer_api_key_from_compose_json() {
  local compose_json_path="$1"

  jq -r '
    [.services[]?.environment?.VLLM_API_KEY // empty]
    | map(select(length > 0))
    | unique
    | if length == 0 then "" elif length == 1 then .[0] else "__MULTIPLE__" end
  ' "$compose_json_path"
}

command_flag_value() {
  local service_json="$1"
  local flag="$2"

  jq -r --arg flag "$flag" '
    (.command | index($flag)) as $index
    | if $index == null or ($index + 1) >= (.command | length)
      then ""
      else .command[$index + 1]
      end
  ' <<<"$service_json"
}