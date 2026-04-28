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

assert_command_lacks_flag() {
  local service_json="$1"
  local flag="$2"
  local label="$3"

  if jq -e --arg flag "$flag" '.command | index($flag) == null' <<<"$service_json" >/dev/null; then
    pass "$label"
  else
    fail "$label (unexpected flag '$flag')"
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

assert_shared_health_url_resolution() {
  local label="$1"

  if REPO_DIR="$REPO_DIR" node --input-type=module <<'NODE'
import { pathToFileURL } from "node:url";

const repoDir = process.env.REPO_DIR;
const { normalizeModelsConfig, resolveHealthUrl } = await import(pathToFileURL(`${repoDir}/shared/models-config.mjs`).href);

const config = normalizeModelsConfig(
  {
    "alt-port-model": {
      container: "vllm-alt-port",
      port: 8123,
      maxModelLen: 4096,
      toolSupport: "full",
      validatorProfile: "default",
      lifecycle: "normal"
    }
  },
  "<inline-health-url-test>"
);

const cases = [
  ["model id lookup", resolveHealthUrl(config, "alt-port-model", "vllm-alt-port"), "http://vllm-alt-port:8123/health"],
  ["container lookup", resolveHealthUrl(config, "vllm-alt-port", "vllm-alt-port"), "http://vllm-alt-port:8123/health"],
  ["fallback template", resolveHealthUrl(config, "missing-model", "vllm-missing", "http://{name}:8000/health"), "http://vllm-missing:8000/health"]
];

let failed = false;
for (const [name, actual, expected] of cases) {
  if (actual !== expected) {
    console.error(`FAIL ${name}: expected ${expected}, got ${actual}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
NODE
  then
    pass "$label"
  else
    fail "$label"
  fi
}

GPT_20B_JSON="$(resolve_service_json "$ACTIVE_JSON" "gpt-oss-20b")"
GPT_120B_JSON="$(resolve_service_json "$ACTIVE_JSON" "gpt-oss-120b")"
UTILITY_JSON="$(resolve_service_json "$ACTIVE_JSON" "qwen3.5-0.8b")"
QWEN36_27B_FP8_JSON="$(resolve_service_json "$ACTIVE_JSON" "qwen3.6-27b-fp8")"
QWEN36_27B_FP8_MTP_JSON="$(resolve_service_json "$ACTIVE_JSON" "qwen3.6-27b-fp8-mtp")"
QWEN36_35B_A3B_FP8_JSON="$(resolve_service_json "$ACTIVE_JSON" "qwen3.6-35b-a3b-fp8")"
QWEN36_35B_A3B_FP8_MTP_JSON="$(resolve_service_json "$ACTIVE_JSON" "qwen3.6-35b-a3b-fp8-mtp")"
HUIHUI_QWEN36_27B_JSON="$(resolve_service_json "$ACTIVE_JSON" "huihui-qwen3.6-27b-abliterated")"
QWEN35_122B_AUTOROUND_JSON="$(resolve_service_json "$ACTIVE_JSON" "qwen3.5-122b-a10b-int4-autoround")"
HUIHUI_QWEN35_35B_A3B_JSON="$(resolve_service_json "$ACTIVE_JSON" "huihui-qwen3.5-35b-a3b-abliterated")"
JACKRONG_QWEN35_35B_A3B_JSON="$(resolve_service_json "$ACTIVE_JSON" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled")"
QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON="$(resolve_service_json "$ACTIVE_JSON" "qwen3-coder-next-int4-autoround")"
GEMMA4_26B_JSON="$(resolve_service_json "$ACTIVE_JSON" "gemma4-26b-a4b")"
GEMMA4_31B_JSON="$(resolve_service_json "$ACTIVE_JSON" "gemma4-31b")"
HUIHUI_GEMMA4_E2B_JSON="$(resolve_service_json "$ACTIVE_JSON" "huihui-gemma4-e2b-abliterated")"
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
assert_flag_value "$GPT_120B_JSON" "--gpu-memory-utilization" "0.80" "gpt-oss-120b keeps validated memory envelope"
assert_env_value "$GPT_120B_JSON" "TIKTOKEN_ENCODINGS_BASE" "/workspace/vllm/tiktoken_encodings" "gpt-oss-120b uses baked-in tokenizer files"

assert_shared_health_url_resolution "shared health-url resolution handles model ids, container names, and fallback templates"

assert_equals "$(jq -r '.image // ""' <<<"$UTILITY_JSON" | sed 's/@sha256:.*//')" "scitrera/dgx-spark-sglang:0.5.9-t5" "qwen3.5-0.8b uses the SGLang utility image"
assert_flag_value "$UTILITY_JSON" "--model-path" "Qwen/Qwen3.5-0.8B" "qwen3.5-0.8b points at the Qwen 3.5 utility checkpoint"
assert_flag_value "$UTILITY_JSON" "--served-model-name" "qwen3.5-0.8b" "qwen3.5-0.8b keeps the local served model id"
assert_flag_value "$UTILITY_JSON" "--mem-fraction-static" "0.05" "qwen3.5-0.8b uses the validated low-footprint utility memory fraction"
assert_flag_value "$UTILITY_JSON" "--tp-size" "1" "qwen3.5-0.8b keeps single-GPU tensor parallelism"
assert_flag_value "$UTILITY_JSON" "--attention-backend" "triton" "qwen3.5-0.8b pins the Blackwell-safe SGLang attention backend"
assert_flag_value "$UTILITY_JSON" "--context-length" "32768" "qwen3.5-0.8b keeps the conservative utility context limit"
assert_env_value "$UTILITY_JSON" "HF_HUB_CACHE" "/models" "qwen3.5-0.8b reuses the shared Hugging Face cache"

assert_equals "$(jq -r '.image // ""' <<<"$QWEN36_27B_FP8_JSON")" "vllm-node-tf5" "qwen3.6-27b-fp8 uses the TF5 track image"
assert_json_value "$QWEN36_27B_FP8_JSON" '.command[2] // ""' "Qwen/Qwen3.6-27B-FP8" "qwen3.6-27b-fp8 points at the official Qwen 3.6 27B checkpoint"
assert_flag_value "$QWEN36_27B_FP8_JSON" "--served-model-name" "qwen3.6-27b-fp8" "qwen3.6-27b-fp8 keeps the local served model id"
assert_flag_value "$QWEN36_27B_FP8_JSON" "--max-model-len" "262144" "qwen3.6-27b-fp8 keeps the upstream max model length"
assert_flag_value "$QWEN36_27B_FP8_JSON" "--max-num-batched-tokens" "32768" "qwen3.6-27b-fp8 keeps the upstream batched-token budget"
assert_flag_value "$QWEN36_27B_FP8_JSON" "--gpu-memory-utilization" "0.80" "qwen3.6-27b-fp8 keeps the upstream memory envelope"
assert_command_has_flag "$QWEN36_27B_FP8_JSON" "--trust-remote-code" "qwen3.6-27b-fp8 trusts remote code like the upstream recipe"
assert_flag_value "$QWEN36_27B_FP8_JSON" "--chat-template" "/workspace/unsloth.jinja" "qwen3.6-27b-fp8 uses the mounted chat template"
assert_flag_value "$QWEN36_27B_FP8_JSON" "--tool-call-parser" "qwen3_coder" "qwen3.6-27b-fp8 keeps the Qwen tool parser"
assert_flag_value "$QWEN36_27B_FP8_JSON" "--reasoning-parser" "qwen3" "qwen3.6-27b-fp8 keeps the Qwen reasoning parser"
assert_flag_value "$QWEN36_27B_FP8_JSON" "--kv-cache-dtype" "fp8" "qwen3.6-27b-fp8 keeps fp8 KV cache"
assert_flag_value "$QWEN36_27B_FP8_JSON" "--load-format" "instanttensor" "qwen3.6-27b-fp8 keeps the upstream InstantTensor loader"
assert_flag_value "$QWEN36_27B_FP8_JSON" "--attention-backend" "flashinfer" "qwen3.6-27b-fp8 keeps FlashInfer attention"
assert_command_has_flag "$QWEN36_27B_FP8_JSON" "--disable-uvicorn-access-log" "qwen3.6-27b-fp8 suppresses uvicorn access logs"
assert_command_has_flag "$QWEN36_27B_FP8_JSON" "--disable-log-stats" "qwen3.6-27b-fp8 suppresses periodic stats logs"
assert_flag_value "$QWEN36_27B_FP8_JSON" "--tensor-parallel-size" "1" "qwen3.6-27b-fp8 uses single-GPU tensor parallelism"
assert_flag_value "$QWEN36_27B_FP8_JSON" "--pipeline-parallel-size" "1" "qwen3.6-27b-fp8 keeps single-stage pipeline parallelism"
assert_command_has_flag "$QWEN36_27B_FP8_JSON" "--enable-prefix-caching" "qwen3.6-27b-fp8 enables prefix caching"
assert_command_has_flag "$QWEN36_27B_FP8_JSON" "--enable-auto-tool-choice" "qwen3.6-27b-fp8 enables auto tool choice"
assert_env_value "$QWEN36_27B_FP8_JSON" "VLLM_MARLIN_USE_ATOMIC_ADD" "1" "qwen3.6-27b-fp8 enables the Marlin atomic-add workaround"
assert_env_value "$QWEN36_27B_FP8_JSON" "QWEN35_CHAT_TEMPLATE_MODEL_ID" "Qwen/Qwen3.5-0.8B" "qwen3.6-27b-fp8 bootstraps the template installer from the cached generic Qwen checkpoint"
assert_volume_mount "$QWEN36_27B_FP8_JSON" "$REPO_DIR/mods/fix-qwen3-coder-next" "/workspace/mods/fix-qwen3-coder-next" "qwen3.6-27b-fp8 mounts the reusable Qwen runtime patch read-only"
assert_volume_mount "$QWEN36_27B_FP8_JSON" "$REPO_DIR/mods/fix-qwen3.5-chat-template" "/workspace/mods/fix-qwen3.5-chat-template" "qwen3.6-27b-fp8 mounts the reusable chat-template installer read-only"
assert_volume_mount "$QWEN36_27B_FP8_JSON" "$REPO_DIR/mods/fix-qwen3.5-moe-runtime" "/workspace/mods/fix-qwen3.5-moe-runtime" "qwen3.6-27b-fp8 mounts the reusable runtime wrapper read-only"

assert_equals "$(jq -r '.image // ""' <<<"$QWEN36_27B_FP8_MTP_JSON")" "vllm-node-tf5" "qwen3.6-27b-fp8-mtp uses the TF5 track image"
assert_json_value "$QWEN36_27B_FP8_MTP_JSON" '.command[2] // ""' "Qwen/Qwen3.6-27B-FP8" "qwen3.6-27b-fp8-mtp points at the official Qwen 3.6 27B checkpoint"
assert_flag_value "$QWEN36_27B_FP8_MTP_JSON" "--served-model-name" "qwen3.6-27b-fp8-mtp" "qwen3.6-27b-fp8-mtp keeps the local served model id"
assert_flag_value "$QWEN36_27B_FP8_MTP_JSON" "--max-model-len" "262144" "qwen3.6-27b-fp8-mtp keeps the upstream max model length"
assert_flag_value "$QWEN36_27B_FP8_MTP_JSON" "--max-num-batched-tokens" "32768" "qwen3.6-27b-fp8-mtp keeps the upstream batched-token budget"
assert_flag_value "$QWEN36_27B_FP8_MTP_JSON" "--gpu-memory-utilization" "0.80" "qwen3.6-27b-fp8-mtp keeps the upstream memory envelope"
assert_flag_value "$QWEN36_27B_FP8_MTP_JSON" "--tool-call-parser" "qwen3_coder" "qwen3.6-27b-fp8-mtp keeps the Qwen tool parser"
assert_flag_value "$QWEN36_27B_FP8_MTP_JSON" "--reasoning-parser" "qwen3" "qwen3.6-27b-fp8-mtp keeps the Qwen reasoning parser"
assert_flag_value "$QWEN36_27B_FP8_MTP_JSON" "--load-format" "instanttensor" "qwen3.6-27b-fp8-mtp keeps the upstream InstantTensor loader"
assert_command_has_flag "$QWEN36_27B_FP8_MTP_JSON" "--disable-uvicorn-access-log" "qwen3.6-27b-fp8-mtp suppresses uvicorn access logs"
assert_command_has_flag "$QWEN36_27B_FP8_MTP_JSON" "--disable-log-stats" "qwen3.6-27b-fp8-mtp suppresses periodic stats logs"
assert_flag_value "$QWEN36_27B_FP8_MTP_JSON" "--speculative-config" '{"method":"mtp","num_speculative_tokens":2}' "qwen3.6-27b-fp8-mtp keeps the upstream MTP config"
assert_env_value "$QWEN36_27B_FP8_MTP_JSON" "QWEN35_CHAT_TEMPLATE_MODEL_ID" "Qwen/Qwen3.5-0.8B" "qwen3.6-27b-fp8-mtp bootstraps the template installer from the cached generic Qwen checkpoint"
assert_volume_mount "$QWEN36_27B_FP8_MTP_JSON" "$REPO_DIR/mods/fix-qwen3.5-moe-runtime" "/workspace/mods/fix-qwen3.5-moe-runtime" "qwen3.6-27b-fp8-mtp mounts the reusable runtime wrapper read-only"

assert_equals "$(jq -r '.image // ""' <<<"$QWEN36_35B_A3B_FP8_JSON")" "vllm-node-tf5" "qwen3.6-35b-a3b-fp8 uses the TF5 track image"
assert_json_value "$QWEN36_35B_A3B_FP8_JSON" '.command[2] // ""' "Qwen/Qwen3.6-35B-A3B-FP8" "qwen3.6-35b-a3b-fp8 points at the official Qwen 3.6 35B A3B checkpoint"
assert_flag_value "$QWEN36_35B_A3B_FP8_JSON" "--served-model-name" "qwen3.6-35b-a3b-fp8" "qwen3.6-35b-a3b-fp8 keeps the local served model id"
assert_flag_value "$QWEN36_35B_A3B_FP8_JSON" "--max-model-len" "262144" "qwen3.6-35b-a3b-fp8 keeps the upstream max model length"
assert_flag_value "$QWEN36_35B_A3B_FP8_JSON" "--max-num-batched-tokens" "32768" "qwen3.6-35b-a3b-fp8 keeps the upstream batched-token budget"
assert_flag_value "$QWEN36_35B_A3B_FP8_JSON" "--gpu-memory-utilization" "0.84" "qwen3.6-35b-a3b-fp8 uses the tuned local memory envelope"
assert_command_has_flag "$QWEN36_35B_A3B_FP8_JSON" "--trust-remote-code" "qwen3.6-35b-a3b-fp8 trusts remote code like the upstream recipe"
assert_flag_value "$QWEN36_35B_A3B_FP8_JSON" "--chat-template" "/workspace/unsloth.jinja" "qwen3.6-35b-a3b-fp8 uses the mounted chat template"
assert_flag_value "$QWEN36_35B_A3B_FP8_JSON" "--tool-call-parser" "qwen3_coder" "qwen3.6-35b-a3b-fp8 keeps the Qwen tool parser"
assert_flag_value "$QWEN36_35B_A3B_FP8_JSON" "--reasoning-parser" "qwen3" "qwen3.6-35b-a3b-fp8 keeps the Qwen reasoning parser"
assert_flag_value "$QWEN36_35B_A3B_FP8_JSON" "--kv-cache-dtype" "fp8" "qwen3.6-35b-a3b-fp8 keeps fp8 KV cache"
assert_flag_value "$QWEN36_35B_A3B_FP8_JSON" "--load-format" "instanttensor" "qwen3.6-35b-a3b-fp8 keeps the upstream InstantTensor loader"
assert_flag_value "$QWEN36_35B_A3B_FP8_JSON" "--attention-backend" "flashinfer" "qwen3.6-35b-a3b-fp8 keeps FlashInfer attention"
assert_command_has_flag "$QWEN36_35B_A3B_FP8_JSON" "--disable-uvicorn-access-log" "qwen3.6-35b-a3b-fp8 suppresses uvicorn access logs"
assert_command_has_flag "$QWEN36_35B_A3B_FP8_JSON" "--disable-log-stats" "qwen3.6-35b-a3b-fp8 suppresses periodic stats logs"
assert_flag_value "$QWEN36_35B_A3B_FP8_JSON" "--tensor-parallel-size" "1" "qwen3.6-35b-a3b-fp8 uses single-GPU tensor parallelism"
assert_flag_value "$QWEN36_35B_A3B_FP8_JSON" "--pipeline-parallel-size" "1" "qwen3.6-35b-a3b-fp8 keeps single-stage pipeline parallelism"
assert_env_value "$QWEN36_35B_A3B_FP8_JSON" "QWEN35_CHAT_TEMPLATE_MODEL_ID" "Qwen/Qwen3.5-0.8B" "qwen3.6-35b-a3b-fp8 bootstraps the template installer from the cached generic Qwen checkpoint"
assert_volume_mount "$QWEN36_35B_A3B_FP8_JSON" "$REPO_DIR/mods/fix-qwen3-coder-next" "/workspace/mods/fix-qwen3-coder-next" "qwen3.6-35b-a3b-fp8 mounts the reusable Qwen runtime patch read-only"
assert_volume_mount "$QWEN36_35B_A3B_FP8_JSON" "$REPO_DIR/mods/fix-qwen3.5-chat-template" "/workspace/mods/fix-qwen3.5-chat-template" "qwen3.6-35b-a3b-fp8 mounts the reusable chat-template installer read-only"
assert_volume_mount "$QWEN36_35B_A3B_FP8_JSON" "$REPO_DIR/mods/fix-qwen3.5-moe-runtime" "/workspace/mods/fix-qwen3.5-moe-runtime" "qwen3.6-35b-a3b-fp8 mounts the reusable runtime wrapper read-only"

assert_equals "$(jq -r '.image // ""' <<<"$QWEN36_35B_A3B_FP8_MTP_JSON")" "vllm-node-tf5" "qwen3.6-35b-a3b-fp8-mtp uses the TF5 track image"
assert_json_value "$QWEN36_35B_A3B_FP8_MTP_JSON" '.command[2] // ""' "Qwen/Qwen3.6-35B-A3B-FP8" "qwen3.6-35b-a3b-fp8-mtp points at the official Qwen 3.6 35B A3B checkpoint"
assert_flag_value "$QWEN36_35B_A3B_FP8_MTP_JSON" "--served-model-name" "qwen3.6-35b-a3b-fp8-mtp" "qwen3.6-35b-a3b-fp8-mtp keeps the local served model id"
assert_flag_value "$QWEN36_35B_A3B_FP8_MTP_JSON" "--max-model-len" "262144" "qwen3.6-35b-a3b-fp8-mtp keeps the upstream max model length"
assert_flag_value "$QWEN36_35B_A3B_FP8_MTP_JSON" "--max-num-batched-tokens" "32768" "qwen3.6-35b-a3b-fp8-mtp keeps the upstream batched-token budget"
assert_flag_value "$QWEN36_35B_A3B_FP8_MTP_JSON" "--gpu-memory-utilization" "0.84" "qwen3.6-35b-a3b-fp8-mtp uses the tuned local memory envelope"
assert_flag_value "$QWEN36_35B_A3B_FP8_MTP_JSON" "--tool-call-parser" "qwen3_coder" "qwen3.6-35b-a3b-fp8-mtp keeps the Qwen tool parser"
assert_flag_value "$QWEN36_35B_A3B_FP8_MTP_JSON" "--reasoning-parser" "qwen3" "qwen3.6-35b-a3b-fp8-mtp keeps the Qwen reasoning parser"
assert_flag_value "$QWEN36_35B_A3B_FP8_MTP_JSON" "--load-format" "instanttensor" "qwen3.6-35b-a3b-fp8-mtp keeps the upstream InstantTensor loader"
assert_command_has_flag "$QWEN36_35B_A3B_FP8_MTP_JSON" "--disable-uvicorn-access-log" "qwen3.6-35b-a3b-fp8-mtp suppresses uvicorn access logs"
assert_command_has_flag "$QWEN36_35B_A3B_FP8_MTP_JSON" "--disable-log-stats" "qwen3.6-35b-a3b-fp8-mtp suppresses periodic stats logs"
assert_flag_value "$QWEN36_35B_A3B_FP8_MTP_JSON" "--speculative-config" '{"method":"mtp","num_speculative_tokens":2}' "qwen3.6-35b-a3b-fp8-mtp keeps the upstream MTP config"
assert_env_value "$QWEN36_35B_A3B_FP8_MTP_JSON" "QWEN35_CHAT_TEMPLATE_MODEL_ID" "Qwen/Qwen3.5-0.8B" "qwen3.6-35b-a3b-fp8-mtp bootstraps the template installer from the cached generic Qwen checkpoint"
assert_volume_mount "$QWEN36_35B_A3B_FP8_MTP_JSON" "$REPO_DIR/mods/fix-qwen3.5-moe-runtime" "/workspace/mods/fix-qwen3.5-moe-runtime" "qwen3.6-35b-a3b-fp8-mtp mounts the reusable runtime wrapper read-only"

assert_equals "$(jq -r '.image // ""' <<<"$HUIHUI_QWEN36_27B_JSON")" "vllm-node-mxfp4-qwen35" "huihui-qwen3.6-27b-abliterated uses the dedicated qwen3_5-aware image"
assert_json_value "$HUIHUI_QWEN36_27B_JSON" '.build.dockerfile // ""' "./custom-docker-containers/vllm-node-mxfp4-qwen35/Dockerfile" "huihui-qwen3.6-27b-abliterated maps to the repo-local qwen3_5 Dockerfile"
assert_json_value "$HUIHUI_QWEN36_27B_JSON" '.command[2] // ""' "huihui-ai/Huihui-Qwen3.6-27B-abliterated" "huihui-qwen3.6-27b-abliterated points at the Huihui Qwen 3.6 checkpoint"
assert_flag_value "$HUIHUI_QWEN36_27B_JSON" "--served-model-name" "huihui-qwen3.6-27b-abliterated" "huihui-qwen3.6-27b-abliterated keeps the local served model id"
assert_flag_value "$HUIHUI_QWEN36_27B_JSON" "--max-model-len" "262144" "huihui-qwen3.6-27b-abliterated keeps the 262k context target"
assert_flag_value "$HUIHUI_QWEN36_27B_JSON" "--max-num-batched-tokens" "16384" "huihui-qwen3.6-27b-abliterated starts with the conservative batched-token budget"
assert_flag_value "$HUIHUI_QWEN36_27B_JSON" "--gpu-memory-utilization" "0.70" "huihui-qwen3.6-27b-abliterated starts with the conservative memory envelope"
assert_flag_value "$HUIHUI_QWEN36_27B_JSON" "--tool-call-parser" "qwen3_coder" "huihui-qwen3.6-27b-abliterated uses the Qwen coder tool parser"
assert_flag_value "$HUIHUI_QWEN36_27B_JSON" "--reasoning-parser" "qwen3" "huihui-qwen3.6-27b-abliterated keeps the Qwen reasoning parser"
assert_flag_value "$HUIHUI_QWEN36_27B_JSON" "--kv-cache-dtype" "auto" "huihui-qwen3.6-27b-abliterated keeps the conservative automatic KV-cache dtype on the TF5 runtime"
assert_flag_value "$HUIHUI_QWEN36_27B_JSON" "--load-format" "fastsafetensors" "huihui-qwen3.6-27b-abliterated uses fastsafetensors loading"
assert_flag_value "$HUIHUI_QWEN36_27B_JSON" "--attention-backend" "flashinfer" "huihui-qwen3.6-27b-abliterated keeps FlashInfer attention"
assert_command_has_flag "$HUIHUI_QWEN36_27B_JSON" "--enforce-eager" "huihui-qwen3.6-27b-abliterated disables compile-time fusion paths on the TF5 runtime"
assert_command_has_flag "$HUIHUI_QWEN36_27B_JSON" "--disable-uvicorn-access-log" "huihui-qwen3.6-27b-abliterated suppresses uvicorn access logs"
assert_command_has_flag "$HUIHUI_QWEN36_27B_JSON" "--disable-log-stats" "huihui-qwen3.6-27b-abliterated suppresses periodic stats logs"
assert_flag_value "$HUIHUI_QWEN36_27B_JSON" "--chat-template" "/workspace/unsloth.jinja" "huihui-qwen3.6-27b-abliterated uses the mounted Qwen chat template"
assert_flag_value "$HUIHUI_QWEN36_27B_JSON" "--tensor-parallel-size" "1" "huihui-qwen3.6-27b-abliterated uses single-GPU tensor parallelism"
assert_command_has_flag "$HUIHUI_QWEN36_27B_JSON" "--enable-prefix-caching" "huihui-qwen3.6-27b-abliterated enables prefix caching"
assert_command_has_flag "$HUIHUI_QWEN36_27B_JSON" "--enable-auto-tool-choice" "huihui-qwen3.6-27b-abliterated enables auto tool choice"
assert_env_value "$HUIHUI_QWEN36_27B_JSON" "VLLM_MARLIN_USE_ATOMIC_ADD" "1" "huihui-qwen3.6-27b-abliterated enables the Marlin atomic-add workaround"
assert_env_value "$HUIHUI_QWEN36_27B_JSON" "QWEN35_CHAT_TEMPLATE_MODEL_ID" "Qwen/Qwen3.5-0.8B" "huihui-qwen3.6-27b-abliterated bootstraps the template installer from the cached generic Qwen checkpoint"
assert_volume_mount "$HUIHUI_QWEN36_27B_JSON" "$REPO_DIR/mods/fix-qwen3-coder-next" "/workspace/mods/fix-qwen3-coder-next" "huihui-qwen3.6-27b-abliterated mounts the vendored Qwen runtime fix read-only"
assert_volume_mount "$HUIHUI_QWEN36_27B_JSON" "$REPO_DIR/mods/fix-qwen3.5-chat-template" "/workspace/mods/fix-qwen3.5-chat-template" "huihui-qwen3.6-27b-abliterated mounts the vendored chat-template installer read-only"
assert_volume_mount "$HUIHUI_QWEN36_27B_JSON" "$REPO_DIR/mods/fix-qwen3.5-moe-runtime" "/workspace/mods/fix-qwen3.5-moe-runtime" "huihui-qwen3.6-27b-abliterated mounts the reusable Qwen3.5 MoE runtime wrapper read-only"

assert_equals "$(jq -r '.image // ""' <<<"$QWEN35_122B_AUTOROUND_JSON")" "vllm-node-tf5" "qwen3.5-122b-a10b-int4-autoround uses the TF5 track image"
assert_json_value "$QWEN35_122B_AUTOROUND_JSON" '.command[2] // ""' "Intel/Qwen3.5-122B-A10B-int4-AutoRound" "qwen3.5-122b-a10b-int4-autoround points at the Intel AutoRound checkpoint"
assert_flag_value "$QWEN35_122B_AUTOROUND_JSON" "--served-model-name" "qwen3.5-122b-a10b-int4-autoround" "qwen3.5-122b-a10b-int4-autoround keeps the local served model id"
assert_flag_value "$QWEN35_122B_AUTOROUND_JSON" "--max-model-len" "auto" "qwen3.5-122b-a10b-int4-autoround keeps the single-GPU auto max-model-len override"
assert_flag_value "$QWEN35_122B_AUTOROUND_JSON" "--gpu-memory-utilization" "0.70" "qwen3.5-122b-a10b-int4-autoround keeps the working single-GPU memory envelope"
assert_flag_value "$QWEN35_122B_AUTOROUND_JSON" "--max-num-batched-tokens" "8192" "qwen3.5-122b-a10b-int4-autoround keeps the batched-token ceiling from the working recipe"
assert_flag_value "$QWEN35_122B_AUTOROUND_JSON" "--tool-call-parser" "qwen3_coder" "qwen3.5-122b-a10b-int4-autoround keeps the Qwen tool parser"
assert_flag_value "$QWEN35_122B_AUTOROUND_JSON" "--reasoning-parser" "qwen3" "qwen3.5-122b-a10b-int4-autoround keeps the Qwen reasoning parser"
assert_env_value "$QWEN35_122B_AUTOROUND_JSON" "VLLM_MARLIN_USE_ATOMIC_ADD" "1" "qwen3.5-122b-a10b-int4-autoround enables the Marlin atomic-add workaround"
assert_volume_mount "$QWEN35_122B_AUTOROUND_JSON" "$REPO_DIR/mods/fix-qwen3.5-autoround" "/workspace/mods/fix-qwen3.5-autoround" "qwen3.5-122b-a10b-int4-autoround mounts the vendored autoround patch read-only"

assert_equals "$(jq -r '.image // ""' <<<"$HUIHUI_QWEN35_35B_A3B_JSON")" "vllm-node-tf5" "huihui-qwen3.5-35b-a3b-abliterated uses the TF5 track image"
assert_json_value "$HUIHUI_QWEN35_35B_A3B_JSON" '.command[2] // ""' "huihui-ai/Huihui-Qwen3.5-35B-A3B-abliterated" "huihui-qwen3.5-35b-a3b-abliterated points at the local Huihui checkpoint"
assert_flag_value "$HUIHUI_QWEN35_35B_A3B_JSON" "--served-model-name" "huihui-qwen3.5-35b-a3b-abliterated" "huihui-qwen3.5-35b-a3b-abliterated keeps the local served model id"
assert_flag_value "$HUIHUI_QWEN35_35B_A3B_JSON" "--max-model-len" "262144" "huihui-qwen3.5-35b-a3b-abliterated keeps the 262k context target"
assert_flag_value "$HUIHUI_QWEN35_35B_A3B_JSON" "--max-num-batched-tokens" "16384" "huihui-qwen3.5-35b-a3b-abliterated keeps the conservative batched-token budget"
assert_flag_value "$HUIHUI_QWEN35_35B_A3B_JSON" "--gpu-memory-utilization" "0.70" "huihui-qwen3.5-35b-a3b-abliterated keeps the planned normal-lifecycle memory envelope"
assert_flag_value "$HUIHUI_QWEN35_35B_A3B_JSON" "--tool-call-parser" "qwen3_coder" "huihui-qwen3.5-35b-a3b-abliterated uses the Qwen coder tool parser"
assert_flag_value "$HUIHUI_QWEN35_35B_A3B_JSON" "--reasoning-parser" "qwen3" "huihui-qwen3.5-35b-a3b-abliterated keeps the Qwen reasoning parser"
assert_flag_value "$HUIHUI_QWEN35_35B_A3B_JSON" "--kv-cache-dtype" "fp8" "huihui-qwen3.5-35b-a3b-abliterated keeps fp8 KV cache"
assert_flag_value "$HUIHUI_QWEN35_35B_A3B_JSON" "--load-format" "fastsafetensors" "huihui-qwen3.5-35b-a3b-abliterated keeps fastsafetensors loading"
assert_command_lacks_flag "$HUIHUI_QWEN35_35B_A3B_JSON" "--language-model-only" "huihui-qwen3.5-35b-a3b-abliterated keeps multimodal initialization enabled"
assert_flag_value "$HUIHUI_QWEN35_35B_A3B_JSON" "--attention-backend" "flashinfer" "huihui-qwen3.5-35b-a3b-abliterated keeps FlashInfer attention"
assert_flag_value "$HUIHUI_QWEN35_35B_A3B_JSON" "--chat-template" "/workspace/unsloth.jinja" "huihui-qwen3.5-35b-a3b-abliterated uses the mounted Qwen3.5 chat template"
assert_flag_value "$HUIHUI_QWEN35_35B_A3B_JSON" "--tensor-parallel-size" "1" "huihui-qwen3.5-35b-a3b-abliterated uses single-GPU tensor parallelism"
assert_command_has_flag "$HUIHUI_QWEN35_35B_A3B_JSON" "--enable-prefix-caching" "huihui-qwen3.5-35b-a3b-abliterated enables prefix caching"
assert_command_has_flag "$HUIHUI_QWEN35_35B_A3B_JSON" "--enable-auto-tool-choice" "huihui-qwen3.5-35b-a3b-abliterated enables auto tool choice"
assert_env_value "$HUIHUI_QWEN35_35B_A3B_JSON" "HF_HUB_OFFLINE" "1" "huihui-qwen3.5-35b-a3b-abliterated stays offline against the local cache"
assert_env_value "$HUIHUI_QWEN35_35B_A3B_JSON" "TRANSFORMERS_OFFLINE" "1" "huihui-qwen3.5-35b-a3b-abliterated keeps Transformers offline"
assert_env_value "$HUIHUI_QWEN35_35B_A3B_JSON" "VLLM_MARLIN_USE_ATOMIC_ADD" "1" "huihui-qwen3.5-35b-a3b-abliterated enables the Marlin atomic-add workaround"
assert_env_value "$HUIHUI_QWEN35_35B_A3B_JSON" "QWEN35_CHAT_TEMPLATE_MODEL_ID" "huihui-ai/Huihui-Qwen3.5-35B-A3B-abliterated" "huihui-qwen3.5-35b-a3b-abliterated points the template installer at the mounted local checkpoint"
assert_volume_mount "$HUIHUI_QWEN35_35B_A3B_JSON" "$REPO_DIR/mods/fix-qwen3-coder-next" "/workspace/mods/fix-qwen3-coder-next" "huihui-qwen3.5-35b-a3b-abliterated mounts the vendored Qwen3/Coder-Next runtime fix read-only"
assert_volume_mount "$HUIHUI_QWEN35_35B_A3B_JSON" "$REPO_DIR/mods/fix-qwen3.5-chat-template" "/workspace/mods/fix-qwen3.5-chat-template" "huihui-qwen3.5-35b-a3b-abliterated mounts the vendored Qwen3.5 chat-template installer read-only"
assert_volume_mount "$HUIHUI_QWEN35_35B_A3B_JSON" "$REPO_DIR/mods/fix-qwen3.5-moe-runtime" "/workspace/mods/fix-qwen3.5-moe-runtime" "huihui-qwen3.5-35b-a3b-abliterated mounts the reusable Qwen3.5 MoE runtime wrapper read-only"

assert_equals "$(jq -r '.image // ""' <<<"$JACKRONG_QWEN35_35B_A3B_JSON")" "vllm-node-tf5" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled uses the TF5 track image"
assert_json_value "$JACKRONG_QWEN35_35B_A3B_JSON" '.command[2] // ""' "Jackrong/Qwen3.5-35B-A3B-Claude-4.6-Opus-Reasoning-Distilled" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled points at the local Jackrong checkpoint"
assert_flag_value "$JACKRONG_QWEN35_35B_A3B_JSON" "--served-model-name" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled keeps the local served model id"
assert_flag_value "$JACKRONG_QWEN35_35B_A3B_JSON" "--max-model-len" "262144" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled keeps the 262k context target"
assert_flag_value "$JACKRONG_QWEN35_35B_A3B_JSON" "--max-num-batched-tokens" "32768" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled keeps the high batched-token budget"
assert_flag_value "$JACKRONG_QWEN35_35B_A3B_JSON" "--gpu-memory-utilization" "0.80" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled keeps the planned single-GPU memory envelope"
assert_flag_value "$JACKRONG_QWEN35_35B_A3B_JSON" "--tool-call-parser" "qwen3_xml" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled uses the XML-oriented Qwen tool parser"
assert_flag_value "$JACKRONG_QWEN35_35B_A3B_JSON" "--reasoning-parser" "qwen3" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled keeps the Qwen reasoning parser"
assert_flag_value "$JACKRONG_QWEN35_35B_A3B_JSON" "--kv-cache-dtype" "fp8" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled keeps fp8 KV cache"
assert_flag_value "$JACKRONG_QWEN35_35B_A3B_JSON" "--load-format" "fastsafetensors" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled keeps fastsafetensors loading"
assert_command_has_flag "$JACKRONG_QWEN35_35B_A3B_JSON" "--language-model-only" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled runs in language-model-only mode"
assert_flag_value "$JACKRONG_QWEN35_35B_A3B_JSON" "--attention-backend" "flashinfer" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled keeps FlashInfer attention"
assert_flag_value "$JACKRONG_QWEN35_35B_A3B_JSON" "--chat-template" "/workspace/unsloth.jinja" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled uses the mounted Unsloth chat template"
assert_flag_value "$JACKRONG_QWEN35_35B_A3B_JSON" "--tensor-parallel-size" "1" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled uses single-GPU tensor parallelism"
assert_flag_value "$JACKRONG_QWEN35_35B_A3B_JSON" "--distributed-executor-backend" "ray" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled keeps the distributed executor backend"
assert_command_has_flag "$JACKRONG_QWEN35_35B_A3B_JSON" "--enable-prefix-caching" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled enables prefix caching"
assert_command_has_flag "$JACKRONG_QWEN35_35B_A3B_JSON" "--enable-auto-tool-choice" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled enables auto tool choice"
assert_env_value "$JACKRONG_QWEN35_35B_A3B_JSON" "HF_HUB_OFFLINE" "1" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled stays offline against the local cache"
assert_env_value "$JACKRONG_QWEN35_35B_A3B_JSON" "TRANSFORMERS_OFFLINE" "1" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled keeps Transformers offline"
assert_env_value "$JACKRONG_QWEN35_35B_A3B_JSON" "RAY_memory_usage_threshold" "0.99" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled raises Ray's host-memory kill threshold for compile spikes"
assert_env_value "$JACKRONG_QWEN35_35B_A3B_JSON" "VLLM_MARLIN_USE_ATOMIC_ADD" "1" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled enables the Marlin atomic-add workaround"
assert_env_value "$JACKRONG_QWEN35_35B_A3B_JSON" "QWEN35_CHAT_TEMPLATE_MODEL_ID" "Jackrong/Qwen3.5-35B-A3B-Claude-4.6-Opus-Reasoning-Distilled" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled points the template installer at the mounted local checkpoint"
assert_volume_mount "$JACKRONG_QWEN35_35B_A3B_JSON" "$REPO_DIR/mods/fix-qwen3-coder-next" "/workspace/mods/fix-qwen3-coder-next" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled mounts the vendored Qwen3/Coder-Next runtime fix read-only"
assert_volume_mount "$JACKRONG_QWEN35_35B_A3B_JSON" "$REPO_DIR/mods/fix-qwen3.5-chat-template" "/workspace/mods/fix-qwen3.5-chat-template" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled mounts the vendored Qwen3.5 chat-template installer read-only"
assert_volume_mount "$JACKRONG_QWEN35_35B_A3B_JSON" "$REPO_DIR/mods/fix-qwen3.5-moe-runtime" "/workspace/mods/fix-qwen3.5-moe-runtime" "jackrong-qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled mounts the reusable Qwen3.5 MoE runtime wrapper read-only"

assert_equals "$(jq -r '.image // ""' <<<"$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON")" "vllm-node-tf5" "qwen3-coder-next-int4-autoround uses the TF5 track image"
assert_json_value "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" '.command[2] // ""' "Intel/Qwen3-Coder-Next-int4-AutoRound" "qwen3-coder-next-int4-autoround points at the Intel coder-next autoround checkpoint"
assert_flag_value "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "--served-model-name" "qwen3-coder-next-int4-autoround" "qwen3-coder-next-int4-autoround keeps the local served model id"
assert_flag_value "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "--max-model-len" "1048576" "qwen3-coder-next-int4-autoround keeps the configured 1M context window"
assert_command_has_flag "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "--language-model-only" "qwen3-coder-next-int4-autoround runs in language-model-only mode"
assert_command_has_flag "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "--enable-chunked-prefill" "qwen3-coder-next-int4-autoround enables chunked prefill"
assert_flag_value "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "--max-num-batched-tokens" "49152" "qwen3-coder-next-int4-autoround keeps the high batched-token budget"
assert_flag_value "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "--max-num-seqs" "384" "qwen3-coder-next-int4-autoround keeps the high sequence fanout limit"
assert_flag_value "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "--kv-cache-dtype" "fp8" "qwen3-coder-next-int4-autoround keeps fp8 KV cache"
assert_flag_value "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "--optimization-level" "3" "qwen3-coder-next-int4-autoround keeps optimization level 3"
assert_flag_value "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "--performance-mode" "throughput" "qwen3-coder-next-int4-autoround keeps throughput mode"
assert_flag_value "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "--mamba-cache-mode" "align" "qwen3-coder-next-int4-autoround keeps aligned mamba cache mode"
assert_flag_value "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "--hf-overrides" '{"rope_scaling": {"rope_type": "yarn", "factor": 4.0, "original_max_position_embeddings": 262144}}' "qwen3-coder-next-int4-autoround keeps the Yarn rope-scaling override"
assert_env_value "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "VLLM_MARLIN_USE_ATOMIC_ADD" "1" "qwen3-coder-next-int4-autoround enables the Marlin atomic-add workaround"
assert_env_value "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "VLLM_SLEEP_WHEN_IDLE" "0" "qwen3-coder-next-int4-autoround keeps the engine awake while loaded"
assert_env_value "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "VLLM_ALLOW_LONG_MAX_MODEL_LEN" "1" "qwen3-coder-next-int4-autoround allows the extended max-model-len override"
assert_env_value "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "VLLM_MEMORY_PROFILER_ESTIMATE_CUDAGRAPHS" "1" "qwen3-coder-next-int4-autoround estimates CUDA-graph memory during profiling"
assert_env_value "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "SAFETENSORS_FAST_GPU" "1" "qwen3-coder-next-int4-autoround enables fast safetensors GPU reads"
assert_env_value "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "VLLM_USE_FLASHINFER_MOE_FP8" "1" "qwen3-coder-next-int4-autoround enables FlashInfer FP8 MoE mode"
assert_volume_mount "$QWEN3_CODER_NEXT_INT4_AUTOROUND_JSON" "$REPO_DIR/mods/fix-qwen3-next-autoround" "/workspace/mods/fix-qwen3-next-autoround" "qwen3-coder-next-int4-autoround mounts the vendored reverse patch read-only"

assert_equals "$(jq -r '.image // ""' <<<"$GEMMA4_26B_JSON")" "vllm-node-tf5-gemma4" "gemma4-26b-a4b uses the dedicated Gemma-capable TF5 image"
assert_json_value "$GEMMA4_26B_JSON" '.build.dockerfile // ""' "./custom-docker-containers/vllm-node-tf5-gemma4/Dockerfile" "gemma4-26b-a4b maps to the repo-local Gemma overlay Dockerfile"
assert_flag_value "$GEMMA4_26B_JSON" "--tool-call-parser" "gemma4" "gemma4-26b-a4b keeps the upstream tool parser"
assert_flag_value "$GEMMA4_26B_JSON" "--reasoning-parser" "gemma4" "gemma4-26b-a4b keeps the upstream reasoning parser"
assert_flag_value "$GEMMA4_26B_JSON" "--max-model-len" "262144" "gemma4-26b-a4b keeps the upstream max model length"
assert_flag_value "$GEMMA4_26B_JSON" "--max-num-batched-tokens" "8192" "gemma4-26b-a4b keeps the upstream batched token limit"
assert_flag_value "$GEMMA4_26B_JSON" "--tensor-parallel-size" "1" "gemma4-26b-a4b uses the host-safe tensor parallel default"
assert_flag_value "$GEMMA4_26B_JSON" "--distributed-executor-backend" "ray" "gemma4-26b-a4b keeps the upstream executor backend"
assert_env_value "$GEMMA4_26B_JSON" "RAY_memory_usage_threshold" "0.99" "gemma4-26b-a4b raises Ray's host-memory kill threshold for swap-backed startup and first-request spikes"

assert_equals "$(jq -r '.image // ""' <<<"$GEMMA4_31B_JSON")" "vllm-node-tf5-gemma4" "gemma4-31b uses the dedicated Gemma-capable TF5 image"
assert_json_value "$GEMMA4_31B_JSON" '.build.dockerfile // ""' "./custom-docker-containers/vllm-node-tf5-gemma4/Dockerfile" "gemma4-31b maps to the repo-local Gemma overlay Dockerfile"
assert_json_value "$GEMMA4_31B_JSON" '.command[2] // ""' "google/gemma-4-31B-it" "gemma4-31b points at the dense 31B model id"
assert_flag_value "$GEMMA4_31B_JSON" "--tool-call-parser" "gemma4" "gemma4-31b keeps the upstream tool parser"
assert_flag_value "$GEMMA4_31B_JSON" "--reasoning-parser" "gemma4" "gemma4-31b keeps the upstream reasoning parser"
assert_flag_value "$GEMMA4_31B_JSON" "--max-model-len" "262144" "gemma4-31b starts with the mirrored max model length"
assert_flag_value "$GEMMA4_31B_JSON" "--max-num-batched-tokens" "8192" "gemma4-31b starts with the mirrored batched token limit"
assert_flag_value "$GEMMA4_31B_JSON" "--tensor-parallel-size" "1" "gemma4-31b uses the host-safe tensor parallel default"
assert_flag_value "$GEMMA4_31B_JSON" "--distributed-executor-backend" "ray" "gemma4-31b keeps the upstream executor backend"
assert_env_value "$GEMMA4_31B_JSON" "TORCHINDUCTOR_AUTOGRAD_CACHE" "0" "gemma4-31b disables Torch AOTAutograd cache saves to avoid the TF5 Gemma compile pickling bug"
assert_env_value "$GEMMA4_31B_JSON" "RAY_memory_usage_threshold" "0.99" "gemma4-31b raises Ray's host-memory kill threshold for swap-backed startup and first-request spikes"

assert_equals "$(jq -r '.image // ""' <<<"$HUIHUI_GEMMA4_E2B_JSON")" "vllm-node-tf5-gemma4" "huihui-gemma4-e2b-abliterated uses the dedicated Gemma-capable TF5 image lane"
assert_json_value "$HUIHUI_GEMMA4_E2B_JSON" '.build.dockerfile // ""' "./custom-docker-containers/vllm-node-tf5-gemma4/Dockerfile" "huihui-gemma4-e2b-abliterated maps to the repo-local Gemma overlay Dockerfile"
assert_json_value "$HUIHUI_GEMMA4_E2B_JSON" '.command[2] // ""' "huihui-ai/Huihui-gemma-4-E2B-it-abliterated" "huihui-gemma4-e2b-abliterated points at the Huihui Gemma E2B checkpoint"
assert_flag_value "$HUIHUI_GEMMA4_E2B_JSON" "--served-model-name" "huihui-gemma4-e2b-abliterated" "huihui-gemma4-e2b-abliterated keeps the local served model id"
assert_flag_value "$HUIHUI_GEMMA4_E2B_JSON" "--tool-call-parser" "gemma4" "huihui-gemma4-e2b-abliterated keeps the Gemma tool parser"
assert_flag_value "$HUIHUI_GEMMA4_E2B_JSON" "--reasoning-parser" "gemma4" "huihui-gemma4-e2b-abliterated keeps the Gemma reasoning parser"
assert_flag_value "$HUIHUI_GEMMA4_E2B_JSON" "--max-model-len" "131072" "huihui-gemma4-e2b-abliterated keeps the checkpoint's native max model length"
assert_flag_value "$HUIHUI_GEMMA4_E2B_JSON" "--max-num-batched-tokens" "8192" "huihui-gemma4-e2b-abliterated starts with the conservative batched token limit"
assert_flag_value "$HUIHUI_GEMMA4_E2B_JSON" "--gpu-memory-utilization" "0.70" "huihui-gemma4-e2b-abliterated starts with the Gemma host-safe memory envelope"
assert_flag_value "$HUIHUI_GEMMA4_E2B_JSON" "--load-format" "fastsafetensors" "huihui-gemma4-e2b-abliterated uses fastsafetensors loading"
assert_flag_value "$HUIHUI_GEMMA4_E2B_JSON" "--kv-cache-dtype" "auto" "huihui-gemma4-e2b-abliterated keeps automatic KV-cache selection for the BF16 checkpoint"
assert_command_lacks_flag "$HUIHUI_GEMMA4_E2B_JSON" "--quantization" "huihui-gemma4-e2b-abliterated does not force Gemma FP8 quantization flags onto the BF16 checkpoint"
assert_flag_value "$HUIHUI_GEMMA4_E2B_JSON" "--tensor-parallel-size" "1" "huihui-gemma4-e2b-abliterated uses single-GPU tensor parallelism"
assert_flag_value "$HUIHUI_GEMMA4_E2B_JSON" "--distributed-executor-backend" "ray" "huihui-gemma4-e2b-abliterated keeps the Gemma executor backend"
assert_env_value "$HUIHUI_GEMMA4_E2B_JSON" "RAY_memory_usage_threshold" "0.99" "huihui-gemma4-e2b-abliterated raises Ray's host-memory kill threshold for Gemma startup spikes"

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
assert_command_lacks_flag "$NEMOTRON_SERVICE_JSON" "--disable-log-requests" "Nemotron fragment avoids stale request log flag"
assert_command_lacks_flag "$NEMOTRON_SERVICE_JSON" "--disable-log-stats" "Nemotron fragment avoids stale stats log flag"
assert_env_value "$NEMOTRON_SERVICE_JSON" "VLLM_USE_FLASHINFER_MOE_FP4" "0" "Nemotron fragment keeps FP4 MoE override"
assert_volume_mount "$NEMOTRON_SERVICE_JSON" "$REPO_DIR/plugins" "/workspace/plugins" "Nemotron fragment mounts local plugins read-only"

if [[ "$FAILURES" -ne 0 ]]; then
  echo
  echo "Validation failed: $FAILURES of $CHECKS checks failed" >&2
  exit 1
fi

echo
echo "OK: $CHECKS curated compose assertions passed"