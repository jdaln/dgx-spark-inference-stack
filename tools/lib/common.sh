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
  local start_epoch
  local started_epoch
  local status
  local last_status=""
  local last_log_entry=""
  local last_progress_epoch
  local last_report_epoch=0
  local current_epoch
  local running_for
  local idle_for
  local report_interval_seconds="${RUN_MODEL_WAIT_REPORT_INTERVAL_SECONDS:-30}"
  local unhealthy_grace_seconds="${RUN_MODEL_UNHEALTHY_GRACE_SECONDS:-900}"
  local stall_seconds="${RUN_MODEL_STALL_SECONDS:-600}"

  start_epoch="$(date +%s)"
  deadline=$(( start_epoch + timeout_seconds ))
  started_epoch="$(container_started_epoch "$container_name")"
  last_progress_epoch="$start_epoch"

  while (( $(date +%s) < deadline )); do
    current_epoch="$(date +%s)"
    status="$(container_health_status "$container_name")"

    update_container_progress_marker "$container_name" last_log_entry last_progress_epoch "$current_epoch"

    if [[ "$status" != "$last_status" ]]; then
      echo "Waiting for $container_name: status=${status:-unknown}"
      last_status="$status"
      last_report_epoch=0
    fi

    case "$status" in
      healthy|running)
        return 0
        ;;
      exited|dead)
        echo "Container $container_name is $status" >&2
        print_recent_container_logs "$container_name" >&2
        return 1
        ;;
      unhealthy)
        running_for=$(( current_epoch - started_epoch ))
        idle_for=$(( current_epoch - last_progress_epoch ))

        if container_is_running "$container_name" \
          && (( running_for <= unhealthy_grace_seconds || idle_for <= stall_seconds )); then
          if (( current_epoch - last_report_epoch >= report_interval_seconds )); then
            print_container_wait_summary "$container_name" "$running_for" "$idle_for" "$last_log_entry"
            last_report_epoch="$current_epoch"
          fi
          sleep 2
          continue
        fi

        echo "Container $container_name stayed unhealthy without fresh container logs for ${idle_for}s" >&2
        print_recent_container_logs "$container_name" >&2
        return 1
        ;;
    esac

    sleep 2
  done

  echo "Timed out waiting for $container_name to become healthy" >&2
  print_recent_container_logs "$container_name" >&2
  return 1
}

container_health_status() {
  local container_name="$1"

  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name" 2>/dev/null || true
}

container_started_epoch() {
  local container_name="$1"
  local started_at

  started_at="$(docker inspect --format '{{.State.StartedAt}}' "$container_name" 2>/dev/null || true)"
  if [[ -z "$started_at" || "$started_at" == "0001-01-01T00:00:00Z" ]]; then
    date +%s
    return 0
  fi

  date --date="$started_at" +%s 2>/dev/null || date +%s
}

container_last_log_entry() {
  local container_name="$1"

  docker logs --timestamps --tail 1 "$container_name" 2>&1 | tail -n 1 || true
}

truncate_text() {
  local text="$1"
  local max_length="${2:-180}"

  if (( ${#text} <= max_length )); then
    printf '%s' "$text"
    return 0
  fi

  printf '%s...' "${text:0:max_length-3}"
}

update_container_progress_marker() {
  local container_name="$1"
  local log_entry_var_name="$2"
  local progress_epoch_var_name="$3"
  local current_epoch="$4"
  local current_log_entry
  local previous_log_entry

  current_log_entry="$(container_last_log_entry "$container_name")"
  previous_log_entry="${!log_entry_var_name}"

  if [[ -n "$current_log_entry" && "$current_log_entry" != "$previous_log_entry" ]]; then
    printf -v "$log_entry_var_name" '%s' "$current_log_entry"
    printf -v "$progress_epoch_var_name" '%s' "$current_epoch"
  fi
}

print_container_wait_summary() {
  local container_name="$1"
  local running_for="$2"
  local idle_for="$3"
  local log_entry="$4"
  local log_text=""

  if [[ -n "$log_entry" ]]; then
    log_text="${log_entry#* }"
    log_text="$(truncate_text "$log_text")"
    echo "Waiting for $container_name: still starting after ${running_for}s, last log ${idle_for}s ago: $log_text"
    return 0
  fi

  echo "Waiting for $container_name: still starting after ${running_for}s, no container logs yet"
}

print_recent_container_logs() {
  local container_name="$1"

  echo "Recent container logs for $container_name:" >&2
  docker logs --tail 20 "$container_name" 2>&1 || true
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