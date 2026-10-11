#!/usr/bin/env bash
# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
# Start a lane with a variant of its committed command, for A/B tuning with bench-lane.
# Applies a jq filter to the service's rendered command array, writes the result (plus any
# extra environment) as a compose override in tmp/variants/<variant>.json, recreates the
# container with it and waits for health. Helpers available in the filter:
#   setf("--flag"; "value")   set or append a value flag
#   delv("--flag")            drop a value flag and its value
#   addb("--flag")            append a boolean flag
#   delb("--flag")            drop a boolean flag
# Environment keys merge into the committed ones; an override cannot unset a key. --image
# swaps the engine image; --volume HOST:CONTAINER[:ro] adds a mount (repeatable, relative to the
# repo root); --mem-limit caps the container's host memory (e.g. 100g). Until --restore, the
# waker also starts the variant when the lane is requested.
#
# A variant starts outside the waker, so this script applies the waker's rules: no second main
# lane, no utility helper next to an exclusive lane. It kills the variant when free memory
# drops under VARIANT_MIN_FREE_GIB (default 10) during startup.
#
#   bash tools/run-variant.sh [--image IMAGE] [--volume SPEC]... [--mem-limit SIZE] <model-id> <variant> '<jq filter>' ['<env JSON object>']
#   bash tools/run-variant.sh --restore <model-id>    # back to the committed shape, not started
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

require_cmd docker jq node

usage() {
  echo "usage: run-variant.sh [--image IMAGE] [--volume SPEC]... [--mem-limit SIZE] <model-id> <variant> '<jq filter>' ['<env JSON object>']" >&2
  echo "       run-variant.sh --restore <model-id>" >&2
  exit 2
}
image=""
mem_limit=""
volumes=()
while [[ "${1:-}" == --image || "${1:-}" == --volume || "${1:-}" == --mem-limit ]]; do
  [[ $# -ge 2 ]] || usage
  case "$1" in
    --image) image="$2" ;;
    --volume) volumes+=("$2") ;;
    --mem-limit) mem_limit="$2" ;;
  esac
  shift 2
done
[[ $# -ge 2 ]] || usage

# Compose resolves relative paths such as the seccomp profile against the working directory.
cd "$REPO_DIR"
TMP_DIR="$(make_workspace_tmp_dir run-variant)"
trap 'rm -rf "$TMP_DIR"' EXIT
render_active_compose_json "$TMP_DIR/compose.json"

if [[ "$1" == --restore ]]; then
  service="$(resolve_service_json "$TMP_DIR/compose.json" "$2" | jq -r .serviceName)"
  compose_cmd --profile models -f "$ROOT_COMPOSE_FILE" up --no-start --no-deps --force-recreate "$service"
  exit
fi

[[ $# -ge 3 ]] || usage
model_id="$1"
variant="$2"
filter="$3"
env_json="${4:-}"
[[ -n "$env_json" ]] || env_json="{}"
[[ "$variant" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "variant names use letters, digits, dot, dash and underscore" >&2; exit 2; }

SERVICE_JSON="$(resolve_service_json "$TMP_DIR/compose.json" "$model_id")"
service="$(jq -r .serviceName <<<"$SERVICE_JSON")"
container="$(jq -r .containerName <<<"$SERVICE_JSON")"
lifecycle="$(jq -r --arg m "$model_id" '.[$m].lifecycle // "normal"' "$MODELS_FILE")"

# The waker's single-tenant rule: no second main lane next to this one.
for other in $(jq -r --arg m "$model_id" 'to_entries[] | select(.key != $m and .value.lifecycle != "utility") | .value.container' "$MODELS_FILE"); do
  if container_is_running "$other"; then
    echo "$other is running; stop it before starting a variant: docker stop $other" >&2
    exit 1
  fi
done
if [[ "$lifecycle" == exclusive ]]; then
  utility="$(jq -r 'first(to_entries[] | select(.value.lifecycle == "utility") | .value.container) // empty' "$MODELS_FILE")"
  if [[ -n "$utility" ]] && container_is_running "$utility"; then
    echo "stopping the utility helper $utility for exclusive lane $model_id (the waker restarts it later)"
    docker stop -t 30 "$utility" >/dev/null
  fi
fi

defs='def setf($k; $v): (index([$k])) as $i | if $i == null then . + [$k, $v] else .[:$i+1] + [$v] + .[$i+2:] end;
def delv($k): (index([$k])) as $i | if $i == null then . else .[:$i] + .[$i+2:] end;
def addb($k): if index([$k]) == null then . + [$k] else . end;
def delb($k): map(select(. != $k));'
base="$(jq -c '.command' <<<"$SERVICE_JSON")"
cmd="$(jq -c "$defs $filter" <<<"$base")"

mkdir -p "$WORKSPACE_TMP_DIR/variants"
override="$WORKSPACE_TMP_DIR/variants/$variant.json"
volumes_json="$(printf '%s\n' ${volumes[@]+"${volumes[@]}"} | jq -Rnc '[inputs | select(length > 0)]')"
jq -n --arg s "$service" --argjson c "$cmd" --argjson e "$env_json" --arg i "$image" --argjson v "$volumes_json" --arg mem "$mem_limit" \
  '{services: {($s): ({command: $c}
    + (if ($e | length) > 0 then {environment: $e} else {} end)
    + (if $i != "" then {image: $i} else {} end)
    + (if ($v | length) > 0 then {volumes: $v} else {} end)
    + (if $mem != "" then {mem_limit: $mem} else {} end))}}' > "$override"

echo "variant $variant of $model_id, command diff:"
diff <(jq -r '.[]' <<<"$base") <(jq -r '.[]' <<<"$cmd") || true
[[ "$env_json" == "{}" ]] || echo "extra environment: $env_json"
[[ -z "$image" ]] || echo "image: $image"
[[ "$volumes_json" == "[]" ]] || echo "extra volumes: $volumes_json"
[[ -z "$mem_limit" ]] || echo "memory limit: $mem_limit"

available_gib() { awk '/^MemAvailable:/ { printf "%d", $2 / 1048576 }' /proc/meminfo; }

compose_cmd --profile models -f "$ROOT_COMPOSE_FILE" -f "$override" up -d --no-deps --force-recreate "$service"

min_free="${VARIANT_MIN_FREE_GIB:-10}"
deadline=$(( $(date +%s) + ${VARIANT_TIMEOUT_SECONDS:-3600} ))
last_report=0
while (( $(date +%s) < deadline )); do
  free_gib="$(available_gib)"
  if (( free_gib < min_free )); then
    echo "available memory fell to ${free_gib} GiB (floor ${min_free}); killing $container" >&2
    docker kill "$container" >/dev/null 2>&1 || true
    exit 1
  fi
  status="$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || echo missing/)"
  case "$status" in
    running/healthy)
      echo "$container is healthy with variant $variant (${free_gib} GiB available). Restore: bash tools/run-variant.sh --restore $model_id"
      exit 0
      ;;
    exited/*|dead/*|missing/*)
      echo "$container stopped ($status)" >&2
      docker logs --tail 30 "$container" 2>&1 | tail -30 >&2
      exit 1
      ;;
  esac
  if (( $(date +%s) - last_report >= 60 )); then
    echo "waiting for $container: $status, ${free_gib} GiB available"
    last_report=$(date +%s)
  fi
  sleep 2
done
echo "$container not healthy within ${VARIANT_TIMEOUT_SECONDS:-3600}s; killing it" >&2
docker kill "$container" >/dev/null 2>&1 || true
exit 1
