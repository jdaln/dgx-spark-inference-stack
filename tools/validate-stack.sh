#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

require_cmd docker jq node

TMP_DIR="$(make_workspace_tmp_dir validate-stack)"
trap 'rm -rf "$TMP_DIR"' EXIT

ACTIVE_JSON="$TMP_DIR/active.json"
NEMOTRON_JSON="$TMP_DIR/nemotron.json"
EXPECTED_STANDARD_IMAGE="${VLLM_TRACK_IMAGE_STANDARD:-vllm-node}"

render_active_compose_json "$ACTIVE_JSON"
echo "OK: rendered active compose config with models profile"

"$SCRIPT_DIR/check-models.sh" "$MODELS_FILE" "$ROOT_COMPOSE_FILE"

render_fragment_compose_json "$NEMOTRON_JSON" "compose/models-nemotron.yml"
echo "OK: rendered deferred Nemotron fragment with local path base"

FAILURES=0
CHECKS=0

pass() {
  CHECKS=$((CHECKS + 1))
  echo "OK: $1"
}

fail() {
  CHECKS=$((CHECKS + 1))
  FAILURES=$((FAILURES + 1))
  echo "FAIL: $1" >&2
}

assert_equals() {
  local actual="$1"
  local expected="$2"
  local label="$3"

  if [[ "$actual" == "$expected" ]]; then
    pass "$label"
  else
    fail "$label (expected '$expected', got '$actual')"
  fi
}

assert_json_value() {
  local service_json="$1"
  local jq_filter="$2"
  local expected="$3"
  local label="$4"
  local actual

  actual="$(jq -r "$jq_filter" <<<"$service_json")"
  assert_equals "$actual" "$expected" "$label"
}

assert_command_has_flag() {
  local service_json="$1"
  local flag="$2"
  local label="$3"

  if jq -e --arg flag "$flag" '.command | index($flag) != null' <<<"$service_json" >/dev/null; then
    pass "$label"
  else
    fail "$label (missing flag '$flag')"
  fi
}

assert_flag_value() {
  local service_json="$1"
  local flag="$2"
  local expected="$3"
  local label="$4"
  local actual

  actual="$(command_flag_value "$service_json" "$flag")"
  assert_equals "$actual" "$expected" "$label"
}

assert_env_value() {
  local service_json="$1"
  local key="$2"
  local expected="$3"
  local label="$4"
  local actual

  actual="$(jq -r --arg key "$key" '.environment[$key] // ""' <<<"$service_json")"
  assert_equals "$actual" "$expected" "$label"
}

assert_volume_mount() {
  local service_json="$1"
  local source="$2"
  local target="$3"
  local label="$4"

  if jq -e --arg source "$source" --arg target "$target" '.volumes[]? | select(.source == $source and .target == $target)' <<<"$service_json" >/dev/null; then
    pass "$label"
  else
    fail "$label (missing '$source -> $target')"
  fi
}

GPT_20B_JSON="$(resolve_service_json "$ACTIVE_JSON" "gpt-oss-20b")"
GPT_120B_JSON="$(resolve_service_json "$ACTIVE_JSON" "gpt-oss-120b")"
GLM_47_JSON="$(resolve_service_json "$ACTIVE_JSON" "glm-4.7-flash-awq")"
NEMOTRON_SERVICE_JSON="$(resolve_service_json "$NEMOTRON_JSON" "vllm-nemotron-3-nano-30b-nvfp4")"

assert_equals "$(jq -r '.image // ""' <<<"$GPT_20B_JSON")" "vllm-node-mxfp4" "gpt-oss-20b uses MXFP4 track image"
assert_json_value "$GPT_20B_JSON" '.build.dockerfile // ""' "./custom-docker-containers/vllm-node-mxfp4/Dockerfile" "gpt-oss-20b maps to the repo MXFP4 Dockerfile"
assert_flag_value "$GPT_20B_JSON" "--quantization" "mxfp4" "gpt-oss-20b keeps mxfp4 quantization"
assert_flag_value "$GPT_20B_JSON" "--mxfp4-backend" "CUTLASS" "gpt-oss-20b keeps CUTLASS backend"
assert_flag_value "$GPT_20B_JSON" "--attention-backend" "FLASHINFER" "gpt-oss-20b keeps FlashInfer attention"
assert_flag_value "$GPT_20B_JSON" "--tool-call-parser" "openai" "gpt-oss-20b keeps OpenAI tool parser"
assert_env_value "$GPT_20B_JSON" "TIKTOKEN_ENCODINGS_BASE" "/workspace/vllm/tiktoken_encodings" "gpt-oss-20b uses baked-in tokenizer files"

assert_equals "$(jq -r '.image // ""' <<<"$GPT_120B_JSON")" "vllm-node-mxfp4" "gpt-oss-120b uses MXFP4 track image"
assert_json_value "$GPT_120B_JSON" '.build.dockerfile // ""' "./custom-docker-containers/vllm-node-mxfp4/Dockerfile" "gpt-oss-120b maps to the repo MXFP4 Dockerfile"
assert_flag_value "$GPT_120B_JSON" "--reasoning-parser" "openai_gptoss" "gpt-oss-120b keeps reasoning parser"
assert_flag_value "$GPT_120B_JSON" "--gpu-memory-utilization" "0.70" "gpt-oss-120b keeps validated memory envelope"
assert_env_value "$GPT_120B_JSON" "TIKTOKEN_ENCODINGS_BASE" "/workspace/vllm/tiktoken_encodings" "gpt-oss-120b uses baked-in tokenizer files"

assert_equals "$(jq -r '.image // ""' <<<"$GLM_47_JSON")" "local/vllm-glm-4.7-flash-awq:tf5" "glm-4.7-flash-awq uses local TF5 image"
assert_equals "$(jq -r '.build.args.BASE_IMAGE // ""' <<<"$GLM_47_JSON")" "local/vllm-node-tf5:cu131" "glm-4.7-flash-awq build uses refreshed TF5 base"
assert_flag_value "$GLM_47_JSON" "--tool-call-parser" "glm47" "glm-4.7-flash-awq keeps glm47 parser"
assert_flag_value "$GLM_47_JSON" "--reasoning-parser" "glm45" "glm-4.7-flash-awq keeps reasoning parser"
assert_flag_value "$GLM_47_JSON" "--max-model-len" "131072" "glm-4.7-flash-awq keeps validated long-context max model length"
assert_flag_value "$GLM_47_JSON" "--max-num-batched-tokens" "2048" "glm-4.7-flash-awq keeps validated long-context batched token limit"
assert_flag_value "$GLM_47_JSON" "--max-num-seqs" "5" "glm-4.7-flash-awq keeps validated five-user concurrency limit"
assert_flag_value "$GLM_47_JSON" "--gpu-memory-utilization" "0.70" "glm-4.7-flash-awq keeps validated long-context memory envelope"
assert_env_value "$GLM_47_JSON" "HF_HUB_DISABLE_XET" "1" "glm-4.7-flash-awq disables Xet in the local image path"

assert_equals "$(jq -r '.image // ""' <<<"$NEMOTRON_SERVICE_JSON")" "$EXPECTED_STANDARD_IMAGE" "Nemotron fragment uses the selected standard-track image"
assert_flag_value "$NEMOTRON_SERVICE_JSON" "--tool-call-parser" "qwen3_coder" "Nemotron fragment keeps local tool parser"
assert_flag_value "$NEMOTRON_SERVICE_JSON" "--reasoning-parser-plugin" "/workspace/plugins/nano_v3_reasoning_parser.py" "Nemotron fragment keeps local reasoning parser plugin"
assert_flag_value "$NEMOTRON_SERVICE_JSON" "--reasoning-parser" "nano_v3" "Nemotron fragment keeps local reasoning parser"
assert_env_value "$NEMOTRON_SERVICE_JSON" "VLLM_USE_FLASHINFER_MOE_FP4" "0" "Nemotron fragment keeps FP4 MoE override"
assert_volume_mount "$NEMOTRON_SERVICE_JSON" "$REPO_DIR/plugins" "/workspace/plugins" "Nemotron fragment mounts local plugins read-only"

if [[ "$FAILURES" -ne 0 ]]; then
  echo
  echo "Validation failed: $FAILURES of $CHECKS checks failed" >&2
  exit 1
fi

echo
echo "OK: $CHECKS curated compose assertions passed"