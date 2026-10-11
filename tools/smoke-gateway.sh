#!/usr/bin/env bash
# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

require_cmd docker jq curl node

GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8009}"
REQUEST_TIMEOUT_SECONDS="${REQUEST_TIMEOUT_SECONDS:-1800}"
# Roles: plain chat (default), tool calls (coder), images (VL), plus the utility helper.
# Override any role:
#
#   DEFAULT_MODEL=... CODER_MODEL=... VL_MODEL=... bash tools/smoke-gateway.sh
#
# default and coder must be different lanes: the busy check asks for default while coder is up.
UTILITY_MODEL="${UTILITY_MODEL:-lfm2.5-1.2b}"
DEFAULT_MODEL="${DEFAULT_MODEL:-qwen3.8-27b-nvfp4-dflash2}"
CODER_MODEL="${CODER_MODEL:-huihui-qwen3.8-27b-abliterated-nvfp4}"
VL_MODEL="${VL_MODEL:-gemma4-26b-a4b}"
API_KEY="${VLLM_API_KEY:-}"

TMP_DIR="$(make_workspace_tmp_dir smoke-gateway)"
trap 'rm -rf "$TMP_DIR"' EXIT

COMPOSE_JSON="$TMP_DIR/compose.json"
render_active_compose_json "$COMPOSE_JSON"

if [[ -z "$API_KEY" ]]; then
  API_KEY="$(infer_api_key_from_compose_json "$COMPOSE_JSON")"
fi

if [[ -z "$API_KEY" ]]; then
  API_KEY="$DEFAULT_API_KEY"
fi

if [[ "$API_KEY" == "__MULTIPLE__" ]]; then
  echo "Multiple distinct VLLM_API_KEY values are present in compose; export VLLM_API_KEY before running this script." >&2
  exit 1
fi

UTILITY_JSON="$(resolve_service_json "$COMPOSE_JSON" "$UTILITY_MODEL")"
DEFAULT_JSON="$(resolve_service_json "$COMPOSE_JSON" "$DEFAULT_MODEL")"
CODER_JSON="$(resolve_service_json "$COMPOSE_JSON" "$CODER_MODEL")"
VL_JSON="$(resolve_service_json "$COMPOSE_JSON" "$VL_MODEL")"

UTILITY_CONTAINER="$(jq -r '.containerName' <<<"$UTILITY_JSON")"
DEFAULT_SERVICE="$(jq -r '.serviceName' <<<"$DEFAULT_JSON")"
DEFAULT_CONTAINER="$(jq -r '.containerName' <<<"$DEFAULT_JSON")"
CODER_SERVICE="$(jq -r '.serviceName' <<<"$CODER_JSON")"
CODER_CONTAINER="$(jq -r '.containerName' <<<"$CODER_JSON")"
VL_SERVICE="$(jq -r '.serviceName' <<<"$VL_JSON")"
VL_CONTAINER="$(jq -r '.containerName' <<<"$VL_JSON")"

# Check every role's weights before loading anything.
PREFLIGHT_MISSING=0
check_role_weights() {
    local role_var="$1" model_id="$2" service_json="$3"

    if model_weights_present "$service_json"; then
        return 0
    fi

    local ref
    ref="$(service_model_ref "$service_json")"
    echo "MISSING WEIGHTS: role $role_var -> '$model_id' (${ref:-unknown reference})" >&2
    PREFLIGHT_MISSING=1
}

check_role_weights UTILITY_MODEL "$UTILITY_MODEL" "$UTILITY_JSON"
check_role_weights DEFAULT_MODEL "$DEFAULT_MODEL" "$DEFAULT_JSON"
check_role_weights CODER_MODEL   "$CODER_MODEL"   "$CODER_JSON"
check_role_weights VL_MODEL      "$VL_MODEL"      "$VL_JSON"

# The matrix needs the GPU to itself: a main model already up would make a later step fail
# with 429.
PREFLIGHT_BUSY=""
PREFLIGHT_BUSY_SERVICE=""
for busy_model in $(jq -r 'to_entries[] | select(.value.lifecycle != "utility") | .key' "$MODELS_FILE"); do
    busy_container="$(jq -r --arg m "$busy_model" '.[$m].container' "$MODELS_FILE")"
    if container_is_running "$busy_container"; then
        PREFLIGHT_BUSY="$busy_container"
        # `docker compose stop` takes the service name, which can differ from the container name.
        PREFLIGHT_BUSY_SERVICE="$(resolve_service_json "$COMPOSE_JSON" "$busy_model" 2>/dev/null | jq -r '.serviceName // empty')"
        [[ -n "$PREFLIGHT_BUSY_SERVICE" ]] || PREFLIGHT_BUSY_SERVICE="$busy_container"
        break
    fi
done

if [[ -n "$PREFLIGHT_BUSY" ]]; then
    cat >&2 <<EOF
MAIN MODEL ALREADY RUNNING: $PREFLIGHT_BUSY

The smoke matrix starts and stops lanes itself and leaves pre-existing containers alone, so
a model that is already up will make a later leg fail with 429 rather than 200. Stop it
first:

  docker compose --profile models -f "$ROOT_COMPOSE_FILE" stop $PREFLIGHT_BUSY_SERVICE

(The utility helper may stay running; it is expected to coexist.)
EOF
    exit 1
fi

if [[ "$PREFLIGHT_MISSING" -ne 0 ]]; then
    cat >&2 <<EOF

Some roles point at models with no weights on this host, so the matrix cannot run.
Lanes run offline, so weights are never fetched at request time. Download them with

  bash tools/download-weights.sh <model-id>

or point the role at a lane you already have, e.g.:

  DEFAULT_MODEL=<chat lane> CODER_MODEL=<tool-capable lane> VL_MODEL=<multimodal lane> \\
    bash tools/smoke-gateway.sh

Lanes with weights present:
EOF
    for candidate in $(jq -r 'keys[]' "$MODELS_FILE"); do
        candidate_json="$(resolve_service_json "$COMPOSE_JSON" "$candidate" 2>/dev/null)" || continue
        if model_weights_present "$candidate_json"; then
            printf '  %-46s multimodal=%s tools=%s\n' \
                "$candidate" \
                "$(jq -r --arg m "$candidate" '.[$m].multimodal // false' "$MODELS_FILE")" \
                "$(jq -r --arg m "$candidate" '.[$m].toolSupport // "full"' "$MODELS_FILE")" >&2
        fi
    done
    exit 1
fi

# The preflight above only knows models.json; this catches any other vllm-* container.
mapfile -t BLOCKERS < <(docker ps --format '{{.Names}}' | grep '^vllm-' | grep -vxF -e vllm-gateway -e vllm-waker -e vllm-request-validator -e "$UTILITY_CONTAINER" || true)
if [[ "${#BLOCKERS[@]}" -gt 0 ]]; then
  echo "Smoke test refuses to run while unrelated managed model containers are already running:" >&2
  printf '  %s\n' "${BLOCKERS[@]}" >&2
  exit 1
fi

# None of the role lanes ran before, so stop them all on exit.
cleanup() {
  docker compose --profile models -f "$ROOT_COMPOSE_FILE" stop "$VL_SERVICE" "$CODER_SERVICE" "$DEFAULT_SERVICE" >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

request_json() {
  local payload_file="$1"
  local headers_file="$2"
  local body_file="$3"

  curl -sS \
    --max-time "$REQUEST_TIMEOUT_SECONDS" \
    -D "$headers_file" \
    -o "$body_file" \
    -H "Authorization: Bearer $API_KEY" \
    -H 'Content-Type: application/json' \
    -X POST "$GATEWAY_URL/v1/chat/completions" \
    --data @"$payload_file"
}

status_code_from_headers() {
  local headers_file="$1"
  awk '/^HTTP\// { code=$2 } END { print code }' "$headers_file"
}

assert_status() {
  local actual="$1"
  local expected="$2"
  local label="$3"

  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $label (expected status $expected, got $actual)" >&2
    return 1
  fi

  echo "OK: $label"
}

check_json_choices() {
  local body_file="$1"
  local label="$2"

  if jq -e '.choices | length > 0' "$body_file" >/dev/null; then
    echo "OK: $label"
  else
    echo "FAIL: $label" >&2
    cat "$body_file" >&2
    return 1
  fi
}

printf '%s' '{"model":"'"$UTILITY_MODEL"'","messages":[{"role":"user","content":"Reply with ok."}],"temperature":0,"max_tokens":16,"stream":false}' > "$TMP_DIR/utility.json"
request_json "$TMP_DIR/utility.json" "$TMP_DIR/utility.headers" "$TMP_DIR/utility.body"
UTILITY_STATUS="$(status_code_from_headers "$TMP_DIR/utility.headers")"
assert_status "$UTILITY_STATUS" "200" "utility gateway request returned 200"
check_json_choices "$TMP_DIR/utility.body" "utility response includes choices"

printf '%s' '{"model":"'"$DEFAULT_MODEL"'","messages":[{"role":"user","content":"Reply with ok."}],"temperature":0,"max_tokens":16,"stream":false}' > "$TMP_DIR/default.json"
request_json "$TMP_DIR/default.json" "$TMP_DIR/default.headers" "$TMP_DIR/default.body"
DEFAULT_STATUS="$(status_code_from_headers "$TMP_DIR/default.headers")"
assert_status "$DEFAULT_STATUS" "200" "default gateway request returned 200"
check_json_choices "$TMP_DIR/default.body" "default response includes choices"
docker compose --profile models -f "$ROOT_COMPOSE_FILE" stop "$DEFAULT_SERVICE" >/dev/null

cat > "$TMP_DIR/vl.json" <<EOF
{"model":"$VL_MODEL","messages":[{"role":"user","content":[{"type":"text","text":"Reply with one short sentence about this image."},{"type":"image_url","image_url":{"url":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kZ/8AAAAASUVORK5CYII="}}]}],"temperature":0,"max_tokens":24,"stream":false}
EOF
request_json "$TMP_DIR/vl.json" "$TMP_DIR/vl.headers" "$TMP_DIR/vl.body"
VL_STATUS="$(status_code_from_headers "$TMP_DIR/vl.headers")"
assert_status "$VL_STATUS" "200" "VL gateway request returned 200"
check_json_choices "$TMP_DIR/vl.body" "VL response includes choices"
docker compose --profile models -f "$ROOT_COMPOSE_FILE" stop "$VL_SERVICE" >/dev/null

cat > "$TMP_DIR/coder.json" <<EOF
{"model":"$CODER_MODEL","messages":[{"role":"user","content":"Use the available tool to return a tiny plan."}],"tools":[{"type":"function","function":{"name":"emit_plan","description":"Return a tiny plan","parameters":{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"],"additionalProperties":false}}}],"tool_choice":"auto","temperature":0,"max_tokens":1024,"stream":false}
EOF
request_json "$TMP_DIR/coder.json" "$TMP_DIR/coder.headers" "$TMP_DIR/coder.body"
CODER_STATUS="$(status_code_from_headers "$TMP_DIR/coder.headers")"
assert_status "$CODER_STATUS" "200" "coder gateway request returned 200"
check_json_choices "$TMP_DIR/coder.body" "coder response includes choices"
if jq -e '.choices[0].message.tool_calls | length > 0' "$TMP_DIR/coder.body" >/dev/null; then
  echo "OK: coder response returned structured tool_calls"
else
  echo "FAIL: coder response returned no structured tool_calls" >&2
  cat "$TMP_DIR/coder.body" >&2
  exit 1
fi

printf '%s' '{"model":"'"$DEFAULT_MODEL"'","messages":[{"role":"user","content":"Reply with ok."}],"temperature":0,"max_tokens":16,"stream":false}' > "$TMP_DIR/busy.json"
request_json "$TMP_DIR/busy.json" "$TMP_DIR/busy.headers" "$TMP_DIR/busy.body"
BUSY_STATUS="$(status_code_from_headers "$TMP_DIR/busy.headers")"
assert_status "$BUSY_STATUS" "429" "busy-path request returned 429 while coder model was active"
if jq -e '.error.code == "model_busy" and (.error.message | type == "string")' "$TMP_DIR/busy.body" >/dev/null; then
  echo "OK: busy-path response uses OpenAI-compatible busy error"
else
  echo "FAIL: busy-path response did not use OpenAI-compatible busy error" >&2
  cat "$TMP_DIR/busy.body" >&2
  exit 1
fi
if grep -qi '^Retry-After:' "$TMP_DIR/busy.headers"; then
  echo "OK: busy-path response preserved Retry-After header"
else
  echo "FAIL: busy-path response did not include Retry-After header" >&2
  exit 1
fi

echo
echo "OK: gateway smoke matrix passed"
