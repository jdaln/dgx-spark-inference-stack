#!/usr/bin/env bash
# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
# Live regression for a lane on the Maya engine (custom-docker-containers/vllm-node-maya):
# what its wrapper and patches promise, checked on the running lane through the gateway.
#   - nothing about a request reaches a log, the disk or ./models (a canary string in a prompt,
#     in an answer and in tool arguments);
#   - the container is hardened and cannot call out;
#   - Maya's extra routes do not exist, a browser Origin is accepted, an oversized request is a
#     400 the clients recognise;
#   - with --token-budget: a request without max_tokens runs past 4096 tokens (about 5 minutes;
#     this is the measurement behind BACKEND_OWNS_TOKEN_BUDGET in request-validator).
# The lane is started by the first request and left running. Results: tmp/test-maya-lane/.
#
#   bash tools/test-maya-lane.sh [--token-budget] [<model-id>]
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
require_cmd docker jq curl

TOKEN_BUDGET=0
MODEL=glm-5.3-flash-maya-s
for arg in "$@"; do
  case "$arg" in
    --token-budget) TOKEN_BUDGET=1 ;;
    -*) echo "usage: test-maya-lane.sh [--token-budget] [<model-id>]" >&2; exit 2 ;;
    *) MODEL="$arg" ;;
  esac
done

CONTAINER="$(jq -r --arg m "$MODEL" '.[$m].container // empty' "$MODELS_FILE")"
[[ -n "$CONTAINER" ]] || { echo "Unknown model id: $MODEL" >&2; exit 2; }
[[ "$(jq -r --arg m "$MODEL" '.[$m].backend // "vllm"' "$MODELS_FILE")" == maya ]] ||
  { echo "$MODEL is not a Maya lane" >&2; exit 2; }

GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8009}"
API_KEY="${VLLM_API_KEY:-$DEFAULT_API_KEY}"
REQUEST_TIMEOUT_SECONDS="${REQUEST_TIMEOUT_SECONDS:-2700}"
OUT="$WORKSPACE_TMP_DIR/test-maya-lane"
mkdir -p "$OUT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SUMMARY="$OUT/summary-$STAMP.txt"
CANARY="canary-$(date +%s)-q7x"
SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
MARKER="$OUT/marker-$STAMP"
: > "$MARKER"

CHECKS=0
FAILURES=0
pass() { CHECKS=$((CHECKS + 1)); echo "OK: $1" | tee -a "$SUMMARY"; }
fail() { CHECKS=$((CHECKS + 1)); FAILURES=$((FAILURES + 1)); echo "FAIL: $1" | tee -a "$SUMMARY" >&2; }
expect() { if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 (expected '$2', got '$3')"; fi; }

# post <path> <payload> <outfile> [extra curl args]: prints the HTTP status.
post() {
  local path="$1" payload="$2" outfile="$3"
  shift 3
  curl -sS -m "$REQUEST_TIMEOUT_SECONDS" -o "$outfile" -w '%{http_code}' \
    -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' "$@" \
    "$GATEWAY_URL$path" --data "$payload" || true
}
# inside <method> <path> [payload]: the status of a request made inside the container.
inside() {
  local method="$1" path="$2" payload="${3:-}"
  docker exec "$CONTAINER" curl -s -o /dev/null -w '%{http_code}' -m 20 -X "$method" \
    -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
    ${payload:+--data "$payload"} "http://localhost:8000$path" || true
}

echo "Maya lane regression for $MODEL ($CONTAINER), canary $CANARY" | tee -a "$SUMMARY"

# ---- wake the lane, then note what the container holds before the canary -------------------------
st="$(post /v1/chat/completions "$(jq -nc --arg m "$MODEL" '{model: $m, reasoning_effort: "none", max_tokens: 8,
  messages: [{role: "user", content: "Reply with the single word: ready"}]}')" "$OUT/wake-$STAMP.json")"
[[ "$st" == 200 ]] || { fail "the lane does not answer: status $st, $(jq -c '.error' "$OUT/wake-$STAMP.json" 2>/dev/null | cut -c1-200)"; exit 1; }
# The GPU runtime adds its libraries to the container before the root filesystem is locked.
DIFF_BEFORE="$(docker diff "$CONTAINER" 2>&1 | sort)"

# ---- requests that carry the canary -----------------------------------------------------------
body="$(jq -nc --arg m "$MODEL" --arg c "$CANARY" '{model: $m, reasoning_effort: "none", max_tokens: 64,
  messages: [{role: "user", content: ("Repeat this word exactly and say nothing else: " + $c)}]}')"
st="$(post /v1/chat/completions "$body" "$OUT/echo-$STAMP.json")"
if [[ "$st" == 200 ]] && jq -e --arg c "$CANARY" '.choices[0].message.content | contains($c)' "$OUT/echo-$STAMP.json" >/dev/null 2>&1; then
  pass "the lane answers and the canary is in its answer"
else
  fail "chat with the canary: status $st, $(jq -c '.error // .choices[0].message.content' "$OUT/echo-$STAMP.json" 2>/dev/null | cut -c1-160)"
fi

tool='{"type":"function","function":{"name":"record_word","description":"Record a word","parameters":{"type":"object","properties":{"word":{"type":"string"}},"required":["word"]}}}'
body="$(jq -nc --arg m "$MODEL" --arg c "$CANARY" --argjson t "$tool" '{model: $m, max_tokens: 256, tools: [$t], tool_choice: "required",
  messages: [{role: "user", content: ("Record the word " + $c + " with the tool.")}]}')"
st="$(post /v1/chat/completions "$body" "$OUT/tool-$STAMP.json")"
if [[ "$st" == 200 ]] && jq -e --arg c "$CANARY" '.choices[0].message.tool_calls[0].function.arguments | contains($c)' "$OUT/tool-$STAMP.json" >/dev/null 2>&1; then
  pass "the canary is in a tool call's arguments"
else
  fail "tool call with the canary: status $st"
fi

body="$(jq -nc --arg m "$MODEL" --arg c "$CANARY" '{model: $m, reasoning_effort: "none", max_tokens: 32, stream: true,
  messages: [{role: "user", content: ("Say hello. " + $c)}]}')"
st="$(post /v1/chat/completions "$body" "$OUT/origin-$STAMP.txt" -H 'Origin: vscode-webview://test-maya-lane')"
if [[ "$st" == 200 ]] && grep -qF 'data: [DONE]' "$OUT/origin-$STAMP.txt"; then
  pass "a streamed request with a browser Origin header is answered"
else
  fail "request with an Origin header: status $st"
fi

# ---- nothing about them was kept --------------------------------------------------------------
for c in "$CONTAINER" vllm-request-validator vllm-waker vllm-gateway; do
  expect "no canary in the log of $c" "0" "$(docker logs --since "$SINCE" "$c" 2>&1 | grep -cF "$CANARY" || true)"
done
expect "no request line in the lane's log" "0" "$(docker logs --since "$SINCE" "$CONTAINER" 2>&1 | grep -cE '\[maya\] done:|loop guard' || true)"
if [[ "$(docker diff "$CONTAINER" 2>&1 | sort)" == "$DIFF_BEFORE" ]]; then
  pass "the requests changed nothing in the container's filesystem (docker diff)"
else
  fail "docker diff changed during the requests: $(diff <(echo "$DIFF_BEFORE") <(docker diff "$CONTAINER" 2>&1 | sort) | head -5 | tr '\n' ' ')"
fi
# (/tmp and /run/maya are RAM-backed mounts: what is in them is listed below, not by docker diff.)
expect "docker diff names no folder Maya's own code uses" "0" "$(grep -cE ' /(opt|root|home)(/|$)' <<<"$DIFF_BEFORE" || true)"
files="$(docker exec "$CONTAINER" sh -c 'find /tmp /run/maya /dev/shm -type f 2>/dev/null | sort | tr "\n" " "')"
expect "the writable (RAM-backed) folders hold the config and the engine log only" "/run/maya/cfg/config.json /run/maya/log/engine.log " "$files"
expect "no canary in the RAM-backed files" "0" "$(docker exec "$CONTAINER" sh -c "grep -rlF '$CANARY' /tmp /run/maya /dev/shm 2>/dev/null | wc -l")"
expect "the config folder is not writable" "denied" "$(docker exec "$CONTAINER" sh -c 'touch /run/maya/cfg/x 2>/dev/null && echo written || echo denied')"
expect "the image is not writable" "denied" "$(docker exec "$CONTAINER" sh -c 'touch /opt/maya/x 2>/dev/null && echo written || echo denied')"
model_dir="$MODELS_DIR/$(docker inspect -f '{{json .Config.Cmd}}' "$CONTAINER" | jq -r '.[index("--model-path") + 1] | ltrimstr("/models/")' | cut -d/ -f1)"
expect "nothing under ./models changed" "" "$(find "$model_dir" -newer "$MARKER" 2>/dev/null | head -3)"
expect "the lane has no cache folder" "absent" "$([[ -e "$REPO_DIR/cache/$CONTAINER" ]] && echo present || echo absent)"

# ---- hardening and egress ---------------------------------------------------------------------
expect "container shape (read-only root, no capabilities, no-new-privileges, internal network, no published port)" \
  "true ALL no-new-privileges:true vllm_internal {}" \
  "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}} {{join .HostConfig.CapDrop ","}} {{join .HostConfig.SecurityOpt ","}} {{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}} {{json .HostConfig.PortBindings}}' "$CONTAINER" | sed -E 's/[a-z0-9_-]*_?vllm_internal/vllm_internal/')"
network="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$CONTAINER")"
expect "its network has no route out" "true" "$(docker network inspect -f '{{.Internal}}' "$network")"
expect "a request to the internet from inside fails" "failed" \
  "$(docker exec "$CONTAINER" sh -c 'curl -s -m 8 -o /dev/null https://huggingface.co && echo reached || echo failed')"
expect "the writable mounts are RAM only" "0" "$(docker inspect -f '{{json .Mounts}}' "$CONTAINER" | jq '[.[] | select(.RW == true)] | length')"

# ---- Maya's extras are gone -------------------------------------------------------------------
wrong=""
for route in "GET /" "GET /web/app.js" "GET /v1/models" "GET /props" "GET /slots" "GET /metrics" "GET /settings" \
  "GET /mcp" "GET /api/tags" "GET /api/update" "GET /models/sse" "POST /v1/responses" "POST /v1/messages" \
  "POST /v1/strata/stream" "POST /api/pull" "POST /api/chat" "POST /models/unload" "POST /settings" "POST /attach"; do
  method="${route%% *}"
  path="${route#* }"
  status="$(inside "$method" "$path" "$([[ "$method" == POST ]] && echo "{\"model\":\"$MODEL\"}")")"
  [[ "$status" == 404 ]] || wrong+="$route -> $status; "
done
expect "Maya's dashboard, settings, model, update, MCP, Ollama, Responses and Anthropic routes are 404 inside the container" "" "$wrong"
expect "GET /health answers inside the container" "200" "$(inside GET /health)"
st="$(post /v1/responses "$(jq -nc --arg m "$MODEL" '{model: $m, input: "hello"}')" "$OUT/responses-$STAMP.json")"
expect "the Responses API is not offered through the gateway" "404" "$st"

# ---- refusal ablation follows the lane's switch -----------------------------------------------
switch="$(docker inspect -f '{{json .Config.Cmd}}' "$CONTAINER" |
  jq -r '. as $c | ($c | index("--ablate")) as $i | if $i == null then "off" else $c[$i + 1] end')"
expect "refusal ablation is $switch, as the lane's --ablate says" "$([[ "$switch" == on ]] && echo true || echo false)" \
  "$(docker exec "$CONTAINER" curl -s -m 20 http://localhost:8000/health | jq -r '.ablate.default')"
if [[ "$switch" != on ]]; then
  st="$(post /v1/chat/completions "$(jq -nc --arg m "$MODEL" '{model: $m, ablate: true, max_tokens: 8, messages: [{role: "user", content: "hello"}]}')" "$OUT/ablate-$STAMP.json")"
  if [[ "$st" == 400 ]] && jq -e '.error.message | test("refusal direction")' "$OUT/ablate-$STAMP.json" >/dev/null 2>&1; then
    pass "with the switch off a request cannot turn ablation on"
  else
    fail "request with ablate: true and the switch off: status $st, $(jq -c '.error' "$OUT/ablate-$STAMP.json" 2>/dev/null | cut -c1-200)"
  fi
else
  # On the ablated lane both forms are answered: a request may still opt out.
  for flag in true false; do
    st="$(post /v1/chat/completions "$(jq -nc --arg m "$MODEL" --argjson a "$flag" '{model: $m, ablate: $a, reasoning_effort: "none", max_tokens: 8,
      messages: [{role: "user", content: "Reply with the single word: ready"}]}')" "$OUT/ablate-$flag-$STAMP.json")"
    expect "a request with \"ablate\": $flag is answered" "200" "$st"
  done
fi

# ---- long prompts read at full speed ----------------------------------------------------------
# A start that leaves under 2 GB of memory free reads long prompts about six times slower (130
# tokens/s against 750). The lane's wrapper prevents that, and says so when it could not.
started="$(docker inspect -f '{{.State.StartedAt}}' "$CONTAINER")"
expect "the lane started with free memory to spare" "0" \
  "$(docker logs --since "$started" "$CONTAINER" 2>&1 | grep -c 'GB is free after the engine took its memory' || true)"
jq -Rsc --arg m "$MODEL" --arg tag "$STAMP" '{model: $m, max_tokens: 8, reasoning_effort: "none", messages: [
  {role: "system", content: ("Reference material (" + $tag + "):\n" + .)},
  {role: "user", content: "Reply with the single word: read"}]}' \
  "$REPO_DIR/tools/testdata/soak/stack-context-bundle.txt" > "$OUT/long-prompt-body-$STAMP.json"
t0="$(date +%s.%N)"
st="$(post /v1/chat/completions "@$OUT/long-prompt-body-$STAMP.json" "$OUT/long-prompt-$STAMP.json")"
seconds="$(awk -v a="$t0" -v b="$(date +%s.%N)" 'BEGIN {printf "%.1f", b - a}')"
tokens="$(jq -r '.usage.prompt_tokens // 0' "$OUT/long-prompt-$STAMP.json" 2>/dev/null || echo 0)"
tps="$(awk -v t="$tokens" -v s="$seconds" 'BEGIN {printf "%d", (s > 0 ? t / s : 0)}')"
if [[ "$st" == 200 && "$tps" -ge 400 ]]; then
  pass "a $tokens-token prompt is read at $tps tokens/s ($seconds s)"
else
  fail "long prompt: status $st, $tokens tokens in $seconds s ($tps tokens/s; a healthy start reads over 700)"
fi
rm -f "$OUT/long-prompt-body-$STAMP.json"

# ---- the contract the tools rely on -----------------------------------------------------------
st="$(post /v1/chat/completions "$(jq -nc --arg m "$MODEL" '{model: $m, max_tokens: 100000000, messages: [{role: "user", content: "hello"}]}')" "$OUT/overflow-$STAMP.json")"
if [[ "$st" == 400 ]] && jq -e '.error.message | test("maximum context")' "$OUT/overflow-$STAMP.json" >/dev/null 2>&1; then
  pass "a request beyond the context is a 400 with 'maximum context'"
else
  fail "oversized request: status $st, $(jq -c '.error' "$OUT/overflow-$STAMP.json" 2>/dev/null | cut -c1-200)"
fi

if [[ "$TOKEN_BUDGET" -eq 1 ]]; then
  body="$(jq -nc --arg m "$MODEL" '{model: $m, reasoning_effort: "none",
    messages: [{role: "user", content: "Write the integers from 1 to 1500, one per line, with nothing else. Do not stop early and do not summarise."}]}')"
  st="$(post /v1/chat/completions "$body" "$OUT/token-budget-$STAMP.json")"
  tokens="$(jq -r '.usage.completion_tokens // 0' "$OUT/token-budget-$STAMP.json" 2>/dev/null || echo 0)"
  finish="$(jq -r '.choices[0].finish_reason // "?"' "$OUT/token-budget-$STAMP.json" 2>/dev/null || echo "?")"
  if [[ "$st" == 200 && "$tokens" -gt 4096 ]]; then
    pass "a request without max_tokens ran to $tokens tokens (finish=$finish): the engine owns the output budget"
  else
    fail "request without max_tokens: status $st, $tokens tokens, finish=$finish"
  fi
fi

rm -f "$MARKER"
echo | tee -a "$SUMMARY"
if [[ "$FAILURES" -ne 0 ]]; then
  echo "FAILED: $FAILURES of $CHECKS Maya lane checks (summary: ${SUMMARY#"$REPO_DIR"/})" | tee -a "$SUMMARY" >&2
  exit 1
fi
echo "OK: $CHECKS Maya lane checks passed (summary: ${SUMMARY#"$REPO_DIR"/})" | tee -a "$SUMMARY"
