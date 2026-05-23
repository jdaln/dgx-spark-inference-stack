#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

require_cmd curl jq

GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8009}"
REQUEST_TIMEOUT_SECONDS="${REQUEST_TIMEOUT_SECONDS:-30}"

TMP_DIR="$(make_workspace_tmp_dir smoke-errors)"
trap 'rm -rf "$TMP_DIR"' EXIT

request_json() {
  local payload="$1"
  local headers_file="$2"
  local body_file="$3"

  curl -sS \
    --max-time "$REQUEST_TIMEOUT_SECONDS" \
    -D "$headers_file" \
    -o "$body_file" \
    -H 'Content-Type: application/json' \
    -X POST "$GATEWAY_URL/v1/chat/completions" \
    --data "$payload"
}

status_code_from_headers() {
  local headers_file="$1"
  awk '/^HTTP\// { code=$2 } END { print code }' "$headers_file"
}

assert_openai_error() {
  local body_file="$1"
  local expected_code="$2"
  local label="$3"

  if jq -e --arg code "$expected_code" '
    (.error | type == "object") and
    (.error.message | type == "string" and length > 0) and
    (.error.type | type == "string" and length > 0) and
    (.error | has("param")) and
    (.error | has("code")) and
    (.error.code == $code)
  ' "$body_file" >/dev/null; then
    echo "OK: $label"
  else
    echo "FAIL: $label" >&2
    cat "$body_file" >&2
    return 1
  fi
}

run_case() {
  local label="$1"
  local payload="$2"
  local expected_status="$3"
  local expected_code="$4"
  local safe_label

  safe_label="$(tr -cd '[:alnum:]_-' <<<"$label")"
  request_json "$payload" "$TMP_DIR/$safe_label.headers" "$TMP_DIR/$safe_label.body"

  local status
  status="$(status_code_from_headers "$TMP_DIR/$safe_label.headers")"
  if [[ "$status" != "$expected_status" ]]; then
    echo "FAIL: $label returned status $status, expected $expected_status" >&2
    cat "$TMP_DIR/$safe_label.body" >&2
    return 1
  fi

  assert_openai_error "$TMP_DIR/$safe_label.body" "$expected_code" "$label returned OpenAI-compatible error"
}

run_case "invalid-json" '{bad json' "400" "invalid_json"
run_case "missing-model" '{"messages":[{"role":"user","content":"hi"}]}' "400" "missing_model"
run_case "unknown-model" '{"model":"does-not-exist","messages":[{"role":"user","content":"hi"}]}' "404" "model_not_found"

echo
echo "OK: error smoke checks passed"
