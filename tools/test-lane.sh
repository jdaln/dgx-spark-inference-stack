#!/usr/bin/env bash
# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
# Gateway capability check for one or more lanes, driven by each lane's models.json flags:
# cold start, chat with a system turn, leaked <pad> tokens, streaming, tokenize and
# detokenize, tool calls with tool_choice auto and required, a streamed tool call, image
# input, the reasoning-effort mapping and the default thinking state.
# Each lane is stopped after its checks, except the utility helper or with --keep.
# Response bodies stay in tmp/test-lane/<model-id>/, the OK and FAIL lines in
# tmp/test-lane/summary-<time>.txt.
#
#   bash tools/test-lane.sh [--keep] <model-id>...
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

require_cmd docker jq curl node

usage() { echo "usage: test-lane.sh [--keep] <model-id>..." >&2; exit 2; }
KEEP=0
MODELS=()
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    -h|--help) usage ;;
    -*) usage ;;
    *) MODELS+=("$arg") ;;
  esac
done
[[ "${#MODELS[@]}" -gt 0 ]] || usage

GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8009}"
# The first request of each lane includes its cold start.
REQUEST_TIMEOUT_SECONDS="${REQUEST_TIMEOUT_SECONDS:-2700}"
OUT_ROOT="$WORKSPACE_TMP_DIR/test-lane"
mkdir -p "$OUT_ROOT"
SUMMARY="$OUT_ROOT/summary-$(date -u +%Y%m%dT%H%M%SZ).txt"
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kZ/8AAAAASUVORK5CYII='
TOOL='{"type":"function","function":{"name":"emit_plan","description":"Return a tiny plan","parameters":{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}}}'

TMP_DIR="$(make_workspace_tmp_dir test-lane)"
trap 'rm -rf "$TMP_DIR"' EXIT
render_active_compose_json "$TMP_DIR/compose.json"

API_KEY="${VLLM_API_KEY:-$(infer_api_key_from_compose_json "$TMP_DIR/compose.json")}"
API_KEY="${API_KEY:-$DEFAULT_API_KEY}"
if [[ "$API_KEY" == "__MULTIPLE__" ]]; then
  echo "Multiple distinct VLLM_API_KEY values are present in compose; export VLLM_API_KEY." >&2
  exit 1
fi

missing=0
for m in "${MODELS[@]}"; do
  jq -e --arg m "$m" 'has($m)' "$MODELS_FILE" >/dev/null || { echo "Unknown model id: $m" >&2; exit 2; }
  if ! model_weights_present "$(resolve_service_json "$TMP_DIR/compose.json" "$m")"; then
    echo "MISSING WEIGHTS: $m. Run: bash tools/download-weights.sh $m" >&2
    missing=1
  fi
done
[[ "$missing" -eq 0 ]] || exit 1

# A main lane that is up and not under test would make the first start here fail with 429.
for busy in $(jq -r 'to_entries[] | select(.value.lifecycle != "utility") | .key' "$MODELS_FILE"); do
  [[ " ${MODELS[*]} " == *" $busy "* ]] && continue
  if container_is_running "$(jq -r --arg m "$busy" '.[$m].container' "$MODELS_FILE")"; then
    echo "$busy is running; stop it first: docker compose --profile models stop $(resolve_service_json "$TMP_DIR/compose.json" "$busy" | jq -r .serviceName)" >&2
    exit 1
  fi
done

CHECKS=0
FAILURES=0
pass() { CHECKS=$((CHECKS + 1)); echo "OK: $1" | tee -a "$SUMMARY"; }
fail() { CHECKS=$((CHECKS + 1)); FAILURES=$((FAILURES + 1)); echo "FAIL: $1" | tee -a "$SUMMARY" >&2; }

# post <path> <payload> <outfile>: prints the HTTP status.
post() {
  curl -sS -m "$REQUEST_TIMEOUT_SECONDS" -o "$3" -w '%{http_code}' \
    -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
    "$GATEWAY_URL$1" --data "$2" || true
}

content() { jq -r '.choices[0].message.content // ""' "$1" 2>/dev/null; }
summary() { jq -r '"finish=\(.choices[0].finish_reason // .error.code // "?")"' "$1" 2>/dev/null || echo "unparsable body"; }

test_lane() {
  local m="$1" out container tools mm effort backend extra body st f
  out="$OUT_ROOT/$m"
  rm -rf "$out"
  mkdir -p "$out"
  container="$(jq -r --arg m "$m" '.[$m].container' "$MODELS_FILE")"
  tools="$(jq -r --arg m "$m" '.[$m].toolSupport // "full"' "$MODELS_FILE")"
  mm="$(jq -r --arg m "$m" '.[$m].multimodal // false' "$MODELS_FILE")"
  effort="$(jq -r --arg m "$m" '.[$m].reasoningEffort // ""' "$MODELS_FILE")"
  backend="$(jq -r --arg m "$m" '.[$m].backend // "vllm"' "$MODELS_FILE")"
  extra='{}'
  [[ "$effort" == graded ]] && extra='{"reasoning_effort":"low"}'

  # Cold start. When the waker gives up first, wait for the container and retry once.
  body="$(jq -nc --arg m "$m" --argjson x "$extra" '{model: $m, messages: [{role: "user", content: "Reply with exactly the word: ok"}], max_tokens: 1024} + $x')"
  f="$out/basic.json"
  st="$(post /v1/chat/completions "$body" "$f")"
  if [[ "$st" == 503 ]] && jq -e '.error.code == "model_health_timeout"' "$f" >/dev/null 2>&1; then
    wait_for_container_health "$container" "$REQUEST_TIMEOUT_SECONDS" >/dev/null || true
    st="$(post /v1/chat/completions "$body" "$f")"
  fi
  if [[ "$st" != 200 || -z "$(content "$f" | tr -d '[:space:]')" ]]; then
    fail "$m chat: status $st, $(summary "$f"); skipping its other checks"
    return
  fi
  pass "$m chat ($(summary "$f"))"

  # System turn, with special tokens kept so leaked <pad> tokens show up in the text.
  body="$(jq -nc --arg m "$m" --argjson x "$extra" '{model: $m, messages: [{role: "system", content: "You are a helpful assistant."}, {role: "user", content: "Name three primary colors."}], max_tokens: 1024, skip_special_tokens: false} + $x')"
  f="$out/system.json"
  st="$(post /v1/chat/completions "$body" "$f")"
  if [[ "$st" == 200 && -n "$(content "$f" | tr -d '[:space:]')" ]] && ! content "$f" | grep -qF '<pad>'; then
    pass "$m system turn, no <pad> tokens"
  else
    fail "$m system turn: status $st, $(summary "$f"), <pad> count $(content "$f" | grep -oF '<pad>' | wc -l)"
  fi

  body="$(jq -nc --arg m "$m" --argjson x "$extra" '{model: $m, stream: true, messages: [{role: "user", content: "Count from 1 to 5."}], max_tokens: 512} + $x')"
  f="$out/stream.txt"
  st="$(post /v1/chat/completions "$body" "$f")"
  if [[ "$st" == 200 ]] && grep -qF 'data: [DONE]' "$f" && grep -qE '"(content|reasoning|reasoning_content)":"[^"]' "$f"; then
    pass "$m stream"
  else
    fail "$m stream: status $st, [DONE] $(grep -cF 'data: [DONE]' "$f")"
  fi

  if [[ "$backend" != sglang ]]; then
    f="$out/tokenize.json"
    st="$(post /tokenize "$(jq -nc --arg m "$m" '{model: $m, messages: [{role: "user", content: "hello"}]}')" "$f")"
    if [[ "$st" == 200 ]] && jq -e '.count > 0' "$f" >/dev/null 2>&1; then
      pass "$m tokenize"
      st="$(post /detokenize "$(jq -c --arg m "$m" '{model: $m, tokens: .tokens}' "$f")" "$out/detokenize.json")"
      if [[ "$st" == 200 ]] && jq -e '.prompt | contains("hello")' "$out/detokenize.json" >/dev/null 2>&1; then
        pass "$m detokenize"
      else
        fail "$m detokenize: status $st"
      fi
    else
      fail "$m tokenize: status $st"
    fi
  fi

  if [[ "$tools" != none ]]; then
    local choice
    for choice in auto required; do
      body="$(jq -nc --arg m "$m" --arg c "$choice" --argjson t "$TOOL" --argjson x "$extra" '{model: $m, messages: [{role: "user", content: "Use the available tool to return a tiny plan."}], tools: [$t], tool_choice: $c, max_tokens: 1024} + $x')"
      f="$out/tools-$choice.json"
      st="$(post /v1/chat/completions "$body" "$f")"
      if [[ "$st" == 200 ]] && jq -e '.choices[0].message.tool_calls[0].function | .name == "emit_plan" and (.arguments | fromjson | .summary | type == "string")' "$f" >/dev/null 2>&1; then
        pass "$m tool_choice=$choice"
      else
        fail "$m tool_choice=$choice: status $st, $(summary "$f"), tool_calls $(jq -r '.choices[0].message.tool_calls // [] | length' "$f" 2>/dev/null)"
      fi
    done

    # Clients such as OpenCode and Cline stream tool calls: the argument chunks must join into
    # valid JSON.
    body="$(jq -nc --arg m "$m" --argjson t "$TOOL" --argjson x "$extra" '{model: $m, stream: true, messages: [{role: "user", content: "Use the available tool to return a tiny plan."}], tools: [$t], tool_choice: "required", max_tokens: 1024} + $x')"
    f="$out/tools-stream.txt"
    st="$(post /v1/chat/completions "$body" "$f")"
    local name args
    name="$(sed -n 's/^data: \({.*\)$/\1/p' "$f" | jq -rs '[.[] | (.choices // [])[0].delta.tool_calls // [] | .[] | .function.name // empty] | join("")' 2>/dev/null)"
    args="$(sed -n 's/^data: \({.*\)$/\1/p' "$f" | jq -rs '[.[] | (.choices // [])[0].delta.tool_calls // [] | .[] | .function.arguments // empty] | join("")' 2>/dev/null)"
    if [[ "$st" == 200 && "$name" == emit_plan ]] && grep -qF 'data: [DONE]' "$f" && jq -e '.summary | type == "string"' <<<"$args" >/dev/null 2>&1; then
      pass "$m streamed tool call"
    else
      fail "$m streamed tool call: status $st, name '$name', arguments '${args:0:80}'"
    fi
  fi

  if [[ "$mm" == true ]]; then
    body="$(jq -nc --arg m "$m" --arg img "$PNG" --argjson x "$extra" '{model: $m, messages: [{role: "user", content: [{type: "text", text: "Describe this image in one short sentence."}, {type: "image_url", image_url: {url: $img}}]}], max_tokens: 1024} + $x')"
    f="$out/image.json"
    st="$(post /v1/chat/completions "$body" "$f")"
    if [[ "$st" == 200 && -n "$(content "$f" | tr -d '[:space:]')" ]]; then
      pass "$m image input"
    else
      fail "$m image input: status $st, $(summary "$f")"
    fi
  fi

  if [[ -n "$effort" ]]; then
    # "high" must reach the lane in a form its template accepts and turn thinking on; "none"
    # must turn it off.
    f="$out/effort-high.json"
    st="$(post /v1/chat/completions "$(jq -nc --arg m "$m" '{model: $m, messages: [{role: "user", content: "What is 2+2?"}], max_tokens: 256, reasoning_effort: "high"}')" "$f")"
    if [[ "$st" == 200 ]] && jq -e '((.choices[0].message.reasoning // .choices[0].message.reasoning_content // "") | length) > 0' "$f" >/dev/null 2>&1; then
      pass "$m reasoning_effort=high turns thinking on"
    else
      fail "$m reasoning_effort=high: status $st, $(summary "$f"), no reasoning returned"
    fi
    f="$out/effort-none.json"
    st="$(post /v1/chat/completions "$(jq -nc --arg m "$m" '{model: $m, messages: [{role: "user", content: "What is 2+2?"}], max_tokens: 256, reasoning_effort: "none"}')" "$f")"
    if [[ "$st" == 200 ]] && jq -e '((.choices[0].message.reasoning // .choices[0].message.reasoning_content // "") | length) == 0' "$f" >/dev/null 2>&1; then
      pass "$m reasoning_effort=none turns thinking off"
    else
      fail "$m reasoning_effort=none: status $st, $(summary "$f")"
    fi
  fi

  # Default thinking state, where models.json defines it: off with thinkingDefault "off", on
  # for graded lanes unless their default effort is "none".
  local think_default effort_default expect=""
  think_default="$(jq -r --arg m "$m" '.[$m].thinkingDefault // "template"' "$MODELS_FILE")"
  effort_default="$(jq -r --arg m "$m" '.[$m].reasoningEffortDefault // ""' "$MODELS_FILE")"
  if [[ "$think_default" == off ]]; then
    expect=off
  elif [[ "$effort" == graded && "$effort_default" != none ]]; then
    expect=on
  fi
  if [[ -n "$expect" ]]; then
    f="$out/thinking-default.json"
    st="$(post /v1/chat/completions "$(jq -nc --arg m "$m" '{model: $m, messages: [{role: "user", content: "What is 2+2?"}], max_tokens: 1024}')" "$f")"
    local got=off
    jq -e '((.choices[0].message.reasoning // .choices[0].message.reasoning_content // "") | length) > 0' "$f" >/dev/null 2>&1 && got=on
    if [[ "$st" == 200 && "$got" == "$expect" ]]; then
      pass "$m thinking is $expect by default"
    else
      fail "$m default thinking: status $st, expected $expect, got $got"
    fi
  fi
}

for i in "${!MODELS[@]}"; do
  m="${MODELS[$i]}"
  test_lane "$m"
  if [[ "$KEEP" -eq 0 && "$(jq -r --arg m "$m" '.[$m].lifecycle' "$MODELS_FILE")" != utility ]]; then
    compose_cmd --profile models -f "$ROOT_COMPOSE_FILE" stop "$(resolve_service_json "$TMP_DIR/compose.json" "$m" | jq -r .serviceName)" >/dev/null 2>&1 || true
    # Let unified memory settle before the next lane starts.
    if [[ "$i" -lt $((${#MODELS[@]} - 1)) ]]; then sleep 15; fi
  fi
done

echo
if [[ "$FAILURES" -ne 0 ]]; then
  echo "FAILED: $FAILURES of $CHECKS lane checks; bodies in ${OUT_ROOT#"$REPO_DIR"/}/" | tee -a "$SUMMARY" >&2
  echo "summary: ${SUMMARY#"$REPO_DIR"/}" >&2
  exit 1
fi
echo "OK: $CHECKS lane checks passed" | tee -a "$SUMMARY"
echo "summary: ${SUMMARY#"$REPO_DIR"/}"
