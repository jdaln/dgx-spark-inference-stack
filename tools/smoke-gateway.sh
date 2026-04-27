#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

require_cmd docker jq curl node

GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8009}"
REQUEST_TIMEOUT_SECONDS="${REQUEST_TIMEOUT_SECONDS:-1800}"
UTILITY_MODEL="${UTILITY_MODEL:-qwen3.5-0.8b}"
DEFAULT_MODEL="${DEFAULT_MODEL:-glm-4-9b-chat}"
CODER_MODEL="${CODER_MODEL:-qwen2.5-coder-7b-instruct}"
VL_MODEL="${VL_MODEL:-qwen2.5-vl-7b}"
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

DEFAULT_WAS_RUNNING=0
CODER_WAS_RUNNING=0
VL_WAS_RUNNING=0

if container_is_running "$DEFAULT_CONTAINER"; then
  DEFAULT_WAS_RUNNING=1
fi
if container_is_running "$CODER_CONTAINER"; then
  CODER_WAS_RUNNING=1
fi
if container_is_running "$VL_CONTAINER"; then
  VL_WAS_RUNNING=1
fi

if docker ps --format '{{.Names}}' | grep -q '^vllm-'; then
  mapfile -t BLOCKERS < <(docker ps --format '{{.Names}}' | grep '^vllm-' | grep -v '^vllm-gateway$' | grep -v '^vllm-waker$' | grep -v '^vllm-request-validator$' | grep -v "^$UTILITY_CONTAINER$" | grep -v "^$DEFAULT_CONTAINER$" | grep -v "^$CODER_CONTAINER$" | grep -v "^$VL_CONTAINER$" || true)
  if [[ "${#BLOCKERS[@]}" -gt 0 ]]; then
    echo "Smoke test refuses to run while unrelated managed model containers are already running:" >&2
    printf '  %s\n' "${BLOCKERS[@]}" >&2
    exit 1
  fi
fi

cleanup() {
  if [[ "$VL_WAS_RUNNING" -eq 0 ]]; then
    docker compose --profile models -f "$ROOT_COMPOSE_FILE" stop "$VL_SERVICE" >/dev/null 2>&1 || true
  fi
  if [[ "$CODER_WAS_RUNNING" -eq 0 ]]; then
    docker compose --profile models -f "$ROOT_COMPOSE_FILE" stop "$CODER_SERVICE" >/dev/null 2>&1 || true
  fi
  if [[ "$DEFAULT_WAS_RUNNING" -eq 0 ]]; then
    docker compose --profile models -f "$ROOT_COMPOSE_FILE" stop "$DEFAULT_SERVICE" >/dev/null 2>&1 || true
  fi
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
if [[ "$DEFAULT_WAS_RUNNING" -eq 0 ]]; then
  docker compose --profile models -f "$ROOT_COMPOSE_FILE" stop "$DEFAULT_SERVICE" >/dev/null
fi

cat > "$TMP_DIR/vl.json" <<EOF
{"model":"$VL_MODEL","messages":[{"role":"user","content":[{"type":"text","text":"Reply with one short sentence about this image."},{"type":"image_url","image_url":{"url":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kZ/8AAAAASUVORK5CYII="}}]}],"temperature":0,"max_tokens":24,"stream":false}
EOF
request_json "$TMP_DIR/vl.json" "$TMP_DIR/vl.headers" "$TMP_DIR/vl.body"
VL_STATUS="$(status_code_from_headers "$TMP_DIR/vl.headers")"
assert_status "$VL_STATUS" "200" "VL gateway request returned 200"
check_json_choices "$TMP_DIR/vl.body" "VL response includes choices"
if [[ "$VL_WAS_RUNNING" -eq 0 ]]; then
  docker compose --profile models -f "$ROOT_COMPOSE_FILE" stop "$VL_SERVICE" >/dev/null
fi

cat > "$TMP_DIR/coder.json" <<EOF
{"model":"$CODER_MODEL","messages":[{"role":"user","content":"Use the available tool to return a tiny plan."}],"tools":[{"type":"function","function":{"name":"emit_plan","description":"Return a tiny plan","parameters":{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"],"additionalProperties":false}}}],"tool_choice":"auto","temperature":0,"max_tokens":64,"stream":false}
EOF
request_json "$TMP_DIR/coder.json" "$TMP_DIR/coder.headers" "$TMP_DIR/coder.body"
CODER_STATUS="$(status_code_from_headers "$TMP_DIR/coder.headers")"
assert_status "$CODER_STATUS" "200" "coder gateway request returned 200"
check_json_choices "$TMP_DIR/coder.body" "coder response includes choices"

printf '%s' '{"model":"'"$DEFAULT_MODEL"'","messages":[{"role":"user","content":"Reply with ok."}],"temperature":0,"max_tokens":16,"stream":false}' > "$TMP_DIR/busy.json"
request_json "$TMP_DIR/busy.json" "$TMP_DIR/busy.headers" "$TMP_DIR/busy.body"
BUSY_STATUS="$(status_code_from_headers "$TMP_DIR/busy.headers")"
assert_status "$BUSY_STATUS" "429" "busy-path request returned 429 while coder model was active"
if jq -e '.error == "busy"' "$TMP_DIR/busy.body" >/dev/null; then
  echo "OK: busy-path response preserved busy error"
else
  echo "FAIL: busy-path response did not preserve busy error" >&2
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