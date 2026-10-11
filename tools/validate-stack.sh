#!/usr/bin/env bash
# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

require_cmd docker jq node

TMP_DIR="$(make_workspace_tmp_dir validate-stack)"
trap 'rm -rf "$TMP_DIR"' EXIT

ACTIVE_JSON="$TMP_DIR/active.json"
EXPECTED_DFLASH2_IMAGE="${VLLM_TRACK_IMAGE_DFLASH2:-vllm-node-dflash2}"
EXPECTED_FLASHNEXT_IMAGE="${VLLM_TRACK_IMAGE_B12X:-vllm-node-b12x}"

render_active_compose_json "$ACTIVE_JSON"
echo "OK: rendered active compose config with models profile"

"$SCRIPT_DIR/check-models.sh" "$MODELS_FILE" "$ROOT_COMPOSE_FILE"


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

assert_repo_file() {
  local path="$1"
  local label="$2"

  if [[ -f "$REPO_DIR/$path" ]]; then
    pass "$label"
  else
    fail "$label (missing $path)"
  fi
}

assert_repo_file_contains() {
  local path="$1"
  local pattern="$2"
  local label="$3"

  if [[ -f "$REPO_DIR/$path" ]] && grep -qE "$pattern" "$REPO_DIR/$path"; then
    pass "$label"
  else
    fail "$label (no match for /$pattern/ in $path)"
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
UTILITY_JSON="$(resolve_service_json "$ACTIVE_JSON" "lfm2.5-1.2b")"
QWEN38_27B_NVFP4_DFLASH2_JSON="$(resolve_service_json "$ACTIVE_JSON" "qwen3.8-27b-nvfp4-dflash2")"
HUIHUI_QWEN38_27B_JSON="$(resolve_service_json "$ACTIVE_JSON" "huihui-qwen3.8-27b-abliterated")"
HUIHUI_QWEN38_27B_NVFP4_JSON="$(resolve_service_json "$ACTIVE_JSON" "huihui-qwen3.8-27b-abliterated-nvfp4")"
QWEN38_FLASH_NEXT_JSON="$(resolve_service_json "$ACTIVE_JSON" "qwen3.8-flash-next-nvfp4")"
GEMMA4_26B_JSON="$(resolve_service_json "$ACTIVE_JSON" "gemma4-26b-a4b")"
GEMMA4_31B_JSON="$(resolve_service_json "$ACTIVE_JSON" "gemma4-31b")"

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

assert_equals "$(jq -r '.image // ""' <<<"$UTILITY_JSON")" "$EXPECTED_DFLASH2_IMAGE" "lfm2.5-1.2b runs on the current upstream vLLM build"
assert_json_value "$UTILITY_JSON" '.command[3] // ""' "LiquidAI/LFM2.5-1.2B-Instruct" "lfm2.5-1.2b points at the official Liquid AI instruct checkpoint"
assert_flag_value "$UTILITY_JSON" "--served-model-name" "lfm2.5-1.2b" "lfm2.5-1.2b keeps the local served model id"
assert_flag_value "$UTILITY_JSON" "--gpu-memory-utilization" "0.06" "lfm2.5-1.2b keeps the low-footprint utility memory fraction"
assert_flag_value "$UTILITY_JSON" "--max-model-len" "32768" "lfm2.5-1.2b keeps the conservative utility context limit"
assert_flag_value "$UTILITY_JSON" "--tensor-parallel-size" "1" "lfm2.5-1.2b keeps single-GPU tensor parallelism"
assert_command_has_flag "$UTILITY_JSON" "--enforce-eager" "lfm2.5-1.2b stays eager so the utility footprint stays small"
assert_env_value "$UTILITY_JSON" "HF_HUB_CACHE" "/models" "lfm2.5-1.2b reuses the shared Hugging Face cache"

assert_equals "$(jq -r '.image // ""' <<<"$QWEN38_27B_NVFP4_DFLASH2_JSON")" "$EXPECTED_DFLASH2_IMAGE" "qwen3.8-27b-nvfp4-dflash2 uses the DFlash2 track image"
assert_json_value "$QWEN38_27B_NVFP4_DFLASH2_JSON" '.command[3] // ""' "RadixArk/Qwen3.8-27B-NVFP4" "qwen3.8-27b-nvfp4-dflash2 points at the upstream NVFP4 checkpoint"
assert_flag_value "$QWEN38_27B_NVFP4_DFLASH2_JSON" "--served-model-name" "qwen3.8-27b-nvfp4-dflash2" "qwen3.8-27b-nvfp4-dflash2 keeps the local served model id"
assert_flag_value "$QWEN38_27B_NVFP4_DFLASH2_JSON" "--max-model-len" "262144" "qwen3.8-27b-nvfp4-dflash2 keeps the upstream max model length"
assert_flag_value "$QWEN38_27B_NVFP4_DFLASH2_JSON" "--gpu-memory-utilization" "0.80" "qwen3.8-27b-nvfp4-dflash2 uses the tuned solo-host memory envelope (upstream 0.7 is a TP=2 cluster default; 0.85 exceeds free memory on this host)"
assert_flag_value "$QWEN38_27B_NVFP4_DFLASH2_JSON" "--tensor-parallel-size" "1" "qwen3.8-27b-nvfp4-dflash2 runs single-GPU on this solo host"
assert_flag_value "$QWEN38_27B_NVFP4_DFLASH2_JSON" "--kv-cache-dtype" "fp8" "qwen3.8-27b-nvfp4-dflash2 keeps the upstream fp8 KV cache"
assert_flag_value "$QWEN38_27B_NVFP4_DFLASH2_JSON" "--tool-call-parser" "qwen3_xml" "qwen3.8-27b-nvfp4-dflash2 keeps the upstream XML tool parser"
assert_flag_value "$QWEN38_27B_NVFP4_DFLASH2_JSON" "--reasoning-parser" "qwen3" "qwen3.8-27b-nvfp4-dflash2 keeps the Qwen reasoning parser"
assert_flag_value "$QWEN38_27B_NVFP4_DFLASH2_JSON" "--load-format" "instanttensor" "qwen3.8-27b-nvfp4-dflash2 keeps the upstream InstantTensor loader"
assert_flag_value "$QWEN38_27B_NVFP4_DFLASH2_JSON" "--speculative-config" '{"method":"dflash","model":"z-lab/Qwen3.8-27B-DFlash2","revision":"50307d4c4cde6860d4eee73e2547cd786fe8e8a4","num_speculative_tokens":8,"draft_tensor_parallel_size":1,"num_speculative_tokens_per_batch_size":[[1,2,8],[3,4,6],[5,8,4]]}' "qwen3.8-27b-nvfp4-dflash2 runs the pinned DFlash2 draft with depth falling by batch size (8/6/4)"
assert_command_has_flag "$QWEN38_27B_NVFP4_DFLASH2_JSON" "--enable-auto-tool-choice" "qwen3.8-27b-nvfp4-dflash2 enables auto tool choice"
assert_command_has_flag "$QWEN38_27B_NVFP4_DFLASH2_JSON" "--enable-prefix-caching" "qwen3.8-27b-nvfp4-dflash2 keeps prefix caching"
assert_command_has_flag "$QWEN38_27B_NVFP4_DFLASH2_JSON" "--async-scheduling" "qwen3.8-27b-nvfp4-dflash2 keeps async scheduling"
assert_command_has_flag "$QWEN38_27B_NVFP4_DFLASH2_JSON" "--disable-uvicorn-access-log" "qwen3.8-27b-nvfp4-dflash2 suppresses uvicorn access logs"
assert_command_has_flag "$QWEN38_27B_NVFP4_DFLASH2_JSON" "--disable-log-stats" "qwen3.8-27b-nvfp4-dflash2 suppresses periodic stats logs"
assert_command_lacks_flag "$QWEN38_27B_NVFP4_DFLASH2_JSON" "--disable-log-requests" "qwen3.8-27b-nvfp4-dflash2 avoids the stale request log flag"

assert_equals "$(jq -r '.image // ""' <<<"$QWEN38_FLASH_NEXT_JSON")" "$EXPECTED_FLASHNEXT_IMAGE" "qwen3.8-flash-next-nvfp4 runs the B12X image built by the vendored helper delta"
assert_json_value "$QWEN38_FLASH_NEXT_JSON" '.build // "none" | tostring' "none" "qwen3.8-flash-next-nvfp4 has no compose build; the image comes from custom-docker-containers/vllm-node-b12x"
assert_json_value "$QWEN38_FLASH_NEXT_JSON" '.command[2] // ""' "/models/models--local-inference-lab--Qwen3.8-Flash-Next-NVFP4/snapshots/6c01ac378d22f6652c9f392c87700496eca8e5dc" "qwen3.8-flash-next-nvfp4 serves the pinned B12X snapshot by path"
assert_env_value "$QWEN38_FLASH_NEXT_JSON" "HF_HUB_OFFLINE" "1" "qwen3.8-flash-next-nvfp4 never resolves against the hub"
assert_flag_value "$QWEN38_FLASH_NEXT_JSON" "--served-model-name" "qwen3.8-flash-next-nvfp4" "qwen3.8-flash-next-nvfp4 keeps the local served model id"
assert_flag_value "$QWEN38_FLASH_NEXT_JSON" "--max-model-len" "262144" "qwen3.8-flash-next-nvfp4 serves the native context"
assert_flag_value "$QWEN38_FLASH_NEXT_JSON" "--max-num-seqs" "8" "qwen3.8-flash-next-nvfp4 runs up to 8 sequences so a third request does not queue"
assert_flag_value "$QWEN38_FLASH_NEXT_JSON" "--gpu-memory-utilization" "0.80" "qwen3.8-flash-next-nvfp4 keeps the 0.80 memory envelope"
assert_flag_value "$QWEN38_FLASH_NEXT_JSON" "--kv-cache-dtype" "fp8" "qwen3.8-flash-next-nvfp4 runs the recipe's fp8 KV (121/121 bench quality under load)"
assert_flag_value "$QWEN38_FLASH_NEXT_JSON" "--quantization" "modelopt_mixed" "qwen3.8-flash-next-nvfp4 loads the mixed NVFP4/MXFP8 layout"
assert_flag_value "$QWEN38_FLASH_NEXT_JSON" "--load-format" "b12x" "qwen3.8-flash-next-nvfp4 uses the b12x loader"
for _flag in --gdn-decode-kernel --linear-backend --moe-backend; do
    assert_flag_value "$QWEN38_FLASH_NEXT_JSON" "$_flag" "b12x" "qwen3.8-flash-next-nvfp4 uses the b12x kernels for $_flag"
done
assert_flag_value "$QWEN38_FLASH_NEXT_JSON" "--speculative-config" '{"method":"mtp","num_speculative_tokens":4}' "qwen3.8-flash-next-nvfp4 runs the recipe's MTP depth 4"
assert_flag_value "$QWEN38_FLASH_NEXT_JSON" "--tool-call-parser" "qwen3_xml" "qwen3.8-flash-next-nvfp4 keeps the Qwen XML tool parser"
assert_flag_value "$QWEN38_FLASH_NEXT_JSON" "--reasoning-parser" "qwen3" "qwen3.8-flash-next-nvfp4 keeps the Qwen reasoning parser"
assert_command_has_flag "$QWEN38_FLASH_NEXT_JSON" "--enable-chunked-prefill" "qwen3.8-flash-next-nvfp4 keeps chunked prefill"
assert_command_has_flag "$QWEN38_FLASH_NEXT_JSON" "--disable-log-stats" "qwen3.8-flash-next-nvfp4 suppresses per-interval stats logging"
assert_env_value "$QWEN38_FLASH_NEXT_JSON" "VLLM_PLE_TABLE_MEMORY" "disk" "qwen3.8-flash-next-nvfp4 serves the PLE table from disk so the checkpoint fits"
assert_json_value "$QWEN38_FLASH_NEXT_JSON" '.security_opt | join(",")' "no-new-privileges:true,seccomp=./custom-docker-containers/vllm-node-b12x/seccomp-io-uring.json" "qwen3.8-flash-next-nvfp4 blocks privilege gain and adds only io_uring to the default seccomp profile"
assert_equals "$(jq -r '.defaultAction + " " + ([.syscalls[] | select(.action == "SCMP_ACT_ALLOW") | select(.names | any(startswith("io_uring"))) | (.names | join("+")) + (if .args then ":" + (.args | map(.value | tostring) | join(",")) else "" end)] | sort | join(" "))' "$REPO_DIR/custom-docker-containers/vllm-node-b12x/seccomp-io-uring.json")" "SCMP_ACT_ERRNO io_uring_register:0 io_uring_register:1 io_uring_register:2 io_uring_register:3 io_uring_setup+io_uring_enter" "the B12X seccomp profile denies by default and allows io_uring_register only for buffers and files"
assert_json_value "$QWEN38_FLASH_NEXT_JSON" '.cap_drop | join(",")' "ALL" "qwen3.8-flash-next-nvfp4 drops every Linux capability"
assert_json_value "$QWEN38_FLASH_NEXT_JSON" '.cap_add | length | tostring' "0" "qwen3.8-flash-next-nvfp4 adds no capability back"
assert_json_value "$QWEN38_FLASH_NEXT_JSON" '.networks | join(",")' "vllm_internal" "qwen3.8-flash-next-nvfp4 has no egress (internal network only)"
# Upstream's launcher passes --privileged and --ipc=host. No lane in this repo does that.
assert_json_value "$QWEN38_FLASH_NEXT_JSON" '.privileged // false | tostring' "false" "qwen3.8-flash-next-nvfp4 is not privileged"
assert_json_value "$QWEN38_FLASH_NEXT_JSON" '.ipc // ""' "" "qwen3.8-flash-next-nvfp4 keeps its own IPC namespace rather than sharing the host's"
assert_json_value "$QWEN38_FLASH_NEXT_JSON" '.shm_size // ""' "17179869184" "qwen3.8-flash-next-nvfp4 inherits the standard 16g shared-memory size"

# Tracks built by upstream helpers keep their patches and pinned commits in the repo.
for _f in README.md build-metadata.yaml b12x-build.patch seccomp-io-uring.json; do
    assert_repo_file "custom-docker-containers/vllm-node-b12x/$_f" "B12X build input $_f is vendored"
done
EXPECTED_DFLASH2_IMAGE_HUIHUI="${VLLM_TRACK_IMAGE_DFLASH2:-vllm-node-dflash2}"
assert_equals "$(jq -r '.image // ""' <<<"$HUIHUI_QWEN38_27B_JSON")" "$EXPECTED_DFLASH2_IMAGE_HUIHUI" "huihui-qwen3.8-27b-abliterated rides the DFlash2 track, which registers its qwen3_5 architecture"
assert_flag_value "$HUIHUI_QWEN38_27B_JSON" "--model" "huihui-ai/Huihui-Qwen3.8-27B-abliterated" "huihui-qwen3.8-27b-abliterated serves the upstream abliterated checkpoint"
assert_flag_value "$HUIHUI_QWEN38_27B_JSON" "--served-model-name" "huihui-qwen3.8-27b-abliterated" "huihui-qwen3.8-27b-abliterated keeps the local served model id"
assert_flag_value "$HUIHUI_QWEN38_27B_JSON" "--max-model-len" "262144" "huihui-qwen3.8-27b-abliterated serves the native context"
assert_flag_value "$HUIHUI_QWEN38_27B_JSON" "--kv-cache-dtype" "fp8" "huihui-qwen3.8-27b-abliterated uses fp8 KV, which is what makes a 51 GiB BF16 checkpoint fit at full context"
assert_flag_value "$HUIHUI_QWEN38_27B_JSON" "--gpu-memory-utilization" "0.80" "huihui-qwen3.8-27b-abliterated keeps the envelope its heavier weights were sized against"
assert_flag_value "$HUIHUI_QWEN38_27B_JSON" "--tool-call-parser" "qwen3_xml" "huihui-qwen3.8-27b-abliterated keeps the Qwen XML tool parser used by the Qwen3.8 family"
assert_flag_value "$HUIHUI_QWEN38_27B_JSON" "--reasoning-parser" "qwen3" "huihui-qwen3.8-27b-abliterated keeps the Qwen reasoning parser"
# The stock DFlash2 draft keeps its acceptance on the abliterated weights.
assert_flag_value "$HUIHUI_QWEN38_27B_JSON" "--speculative-config" '{"method":"dflash","model":"z-lab/Qwen3.8-27B-DFlash2","revision":"50307d4c4cde6860d4eee73e2547cd786fe8e8a4","num_speculative_tokens":8,"draft_tensor_parallel_size":1,"num_speculative_tokens_per_batch_size":[[1,2,8],[3,4,6],[5,8,4]]}' "huihui-qwen3.8-27b-abliterated runs the stock DFlash2 draft (measured: acceptance held on the abliterated weights)"

# The NVFP4 and BF16 lanes differ only in the checkpoint, so they stay comparable.
assert_flag_value "$HUIHUI_QWEN38_27B_NVFP4_JSON" "--model" "sakamakismile/Huihui-Qwen3.8-27B-abliterated-NVFP4" "huihui-qwen3.8-27b-abliterated-nvfp4 serves the third-party NVFP4 requant under test"
assert_flag_value "$HUIHUI_QWEN38_27B_NVFP4_JSON" "--served-model-name" "huihui-qwen3.8-27b-abliterated-nvfp4" "huihui-qwen3.8-27b-abliterated-nvfp4 uses a distinct served-model-name"
for _flag in --max-model-len --kv-cache-dtype --gpu-memory-utilization --max-num-seqs --tool-call-parser --reasoning-parser --speculative-config; do
    _bf16="$(command_flag_value "$HUIHUI_QWEN38_27B_JSON" "$_flag")"
    _nvfp4="$(command_flag_value "$HUIHUI_QWEN38_27B_NVFP4_JSON" "$_flag")"
    assert_equals "$_nvfp4" "$_bf16" "huihui-qwen3.8-27b-abliterated-nvfp4 matches the BF16 lane on $_flag, so the A/B isolates quantization"
done

assert_repo_file "custom-docker-containers/vllm-node-dflash2/vendor-tiktoken.patch" "DFlash2 local delta is vendored rather than living only in a tmp/ clone"
assert_repo_file "custom-docker-containers/vllm-node-dflash2/fetch-tiktoken.sh" "DFlash2 tiktoken fetch helper is vendored"
assert_repo_file "custom-docker-containers/vllm-node-dflash2/build-metadata.yaml" "DFlash2 records the upstream commit its patch applies to"

# Token budgeting is left to the engine: the gateway exposes the tokenizer endpoints and
# each lane declares its backend.
assert_repo_file_contains "gateway.conf" '^\s*location ~ \^/\(tokenize\|detokenize\)\$' "gateway routes /tokenize and /detokenize to the validator"
assert_repo_file_contains "shared/models-config.mjs" 'ALLOWED_BACKENDS' "models.json declares a serving backend per model rather than assuming vLLM"

# Soaks ask models about this bundle; a stale one makes correct answers look wrong.
if bash "$SCRIPT_DIR/build-soak-bundle.sh" --check >/dev/null 2>&1; then
    pass "soak context bundle is current with its sources"
else
    fail "soak context bundle is stale (run: bash tools/build-soak-bundle.sh)"
fi

# The validator's max_tokens handling depends on the engine, so the declared backend must
# match what the container runs.
backend_mismatches=0
for model_id in $(jq -r 'keys[]' "$MODELS_FILE"); do
    service_json="$(resolve_service_json "$ACTIVE_JSON" "$model_id" 2>/dev/null)" || continue
    command_line="$(jq -r '.commandLine // ""' <<<"$service_json")"
    declared="$(jq -r --arg m "$model_id" '.[$m].backend // "vllm"' "$MODELS_FILE")"

    actual="vllm"
    case "$command_line" in
        *sglang*) actual="sglang" ;;
        *llama-server*|*llama_cpp*) actual="llamacpp" ;;
    esac

    if [[ "$declared" != "$actual" ]]; then
        fail "$model_id launches '$actual' but models.json declares backend '$declared'"
        backend_mismatches=$((backend_mismatches + 1))
    fi
done
if [[ "$backend_mismatches" == "0" ]]; then
    pass "every model's declared backend matches the process its container launches"
fi

# Comments may mention a chars/4 estimate; code may not.
if awk '!/^[[:space:]]*\/\// && /chars?\/4|length \/ 4|estimateInputTokens|getTokenSafetyBuffer/ { found = 1 } END { exit !found }' \
   "$REPO_DIR/request-validator/index.js"; then
    fail "request-validator does not reintroduce gateway-side token estimation"
else
    pass "request-validator does not reintroduce gateway-side token estimation"
fi

assert_equals "$(jq -r '.image // ""' <<<"$GEMMA4_26B_JSON")" "$EXPECTED_FLASHNEXT_IMAGE" "gemma4-26b-a4b runs the B12X image (native FP4 MoE, DFlash)"
assert_json_value "$GEMMA4_26B_JSON" '.build // "none" | tostring' "none" "gemma4-26b-a4b has no compose build; the image comes from custom-docker-containers/vllm-node-b12x"
assert_json_value "$GEMMA4_26B_JSON" '.command[2] // ""' "nvidia/Gemma-4-26B-A4B-NVFP4" "gemma4-26b-a4b serves the NVIDIA ModelOpt NVFP4 checkpoint"
assert_flag_value "$GEMMA4_26B_JSON" "--tool-call-parser" "gemma4" "gemma4-26b-a4b keeps the upstream tool parser"
assert_flag_value "$GEMMA4_26B_JSON" "--reasoning-parser" "gemma4" "gemma4-26b-a4b keeps the upstream reasoning parser"
assert_flag_value "$GEMMA4_26B_JSON" "--max-model-len" "262144" "gemma4-26b-a4b keeps the upstream max model length"
assert_flag_value "$GEMMA4_26B_JSON" "--max-num-batched-tokens" "8192" "gemma4-26b-a4b keeps the upstream batched token limit"
assert_flag_value "$GEMMA4_26B_JSON" "--gpu-memory-utilization" "0.50" "gemma4-26b-a4b takes 50% of memory, which still holds 2.19 full windows of KV"
assert_flag_value "$GEMMA4_26B_JSON" "--tensor-parallel-size" "1" "gemma4-26b-a4b uses the host-safe tensor parallel default"
assert_flag_value "$GEMMA4_26B_JSON" "--distributed-executor-backend" "mp" "gemma4-26b-a4b runs the multiprocess executor (no Ray on the internal network)"
assert_command_lacks_flag "$GEMMA4_26B_JSON" "--quantization" "gemma4-26b-a4b takes its quantization from the checkpoint (online fp8 padded tool prompts)"
assert_command_lacks_flag "$GEMMA4_26B_JSON" "--moe-backend" "gemma4-26b-a4b lets vLLM pick FlashInfer's FP4 MoE (b12x MoE has no GELU-tanh)"
assert_flag_value "$GEMMA4_26B_JSON" "--kv-cache-dtype" "auto" "gemma4-26b-a4b keeps a BF16 KV cache (fp8 KV padded system turns)"
assert_flag_value "$GEMMA4_26B_JSON" "--hf-config-path" "/workspace/gemma4-26b-nvfp4-config" "gemma4-26b-a4b reads the config copy without the uncalibrated fp8 KV scheme"
assert_volume_mount "$GEMMA4_26B_JSON" "$REPO_DIR/shared/gemma4-26b-nvfp4-config" "/workspace/gemma4-26b-nvfp4-config" "gemma4-26b-a4b mounts its config copy"
assert_equals "$(jq -r '.quantization_config | (.quant_algo + "/" + ((.kv_cache_scheme // "none") | tostring))' "$REPO_DIR/shared/gemma4-26b-nvfp4-config/config.json")" "NVFP4/none" "gemma4-26b-a4b config copy keeps NVFP4 and drops the KV scheme"
assert_repo_file "shared/gemma4-26b-nvfp4-config/generation_config.json" "gemma4-26b-a4b config copy keeps the checkpoint's sampling defaults"
assert_equals "$(jq -r '(.command | index("--speculative-config")) as $i | .command[$i + 1] | fromjson | "\(.method) \(.model)@\(.revision) \(.num_speculative_tokens)"' <<<"$GEMMA4_26B_JSON")" "dflash z-lab/gemma-4-26B-A4B-it-DFlash@77d4202772dfe50b2396ec7bac9cfffc7b9e7057 8" "gemma4-26b-a4b drafts with the pinned z-lab DFlash model at depth 8"
assert_env_value "$GEMMA4_26B_JSON" "VLLM_USE_V2_MODEL_RUNNER" "1" "gemma4-26b-a4b runs the V2 model runner (the draft mixes sliding and full attention)"
assert_command_has_flag "$GEMMA4_26B_JSON" "--no-scheduler-reserve-full-isl" "gemma4-26b-a4b turns off the full-prompt admission gate that stalls long prompts"

assert_equals "$(jq -r '.image // ""' <<<"$GEMMA4_31B_JSON")" "$EXPECTED_FLASHNEXT_IMAGE" "gemma4-31b runs the B12X image (DFlash draft)"
assert_json_value "$GEMMA4_31B_JSON" '.build // "none" | tostring' "none" "gemma4-31b has no compose build; the image comes from custom-docker-containers/vllm-node-b12x"
assert_json_value "$GEMMA4_31B_JSON" '.command[2] // ""' "nvidia/Gemma-4-31B-IT-NVFP4" "gemma4-31b serves the NVIDIA ModelOpt NVFP4 checkpoint"
assert_flag_value "$GEMMA4_31B_JSON" "--tool-call-parser" "gemma4" "gemma4-31b keeps the upstream tool parser"
assert_flag_value "$GEMMA4_31B_JSON" "--reasoning-parser" "gemma4" "gemma4-31b keeps the upstream reasoning parser"
assert_flag_value "$GEMMA4_31B_JSON" "--max-model-len" "180224" "gemma4-31b serves 180224 tokens: a full window with the draft needs ~85% of memory"
assert_flag_value "$GEMMA4_31B_JSON" "--gpu-memory-utilization" "0.75" "gemma4-31b takes 75% of memory, leaving the host ~20 GiB"
assert_flag_value "$GEMMA4_31B_JSON" "--max-num-batched-tokens" "8192" "gemma4-31b starts with the mirrored batched token limit"
assert_flag_value "$GEMMA4_31B_JSON" "--tensor-parallel-size" "1" "gemma4-31b uses the host-safe tensor parallel default"
assert_flag_value "$GEMMA4_31B_JSON" "--distributed-executor-backend" "mp" "gemma4-31b runs the multiprocess executor (no Ray on the internal network)"
assert_equals "$(jq -r '(.command | index("--speculative-config")) as $i | .command[$i + 1] | fromjson | "\(.method) \(.model)@\(.revision) \(.num_speculative_tokens)"' <<<"$GEMMA4_31B_JSON")" "dflash z-lab/gemma-4-31B-it-DFlash@eabd648301ce28583cc14757912e5e0f84e152e1 8" "gemma4-31b drafts with the pinned z-lab DFlash model at depth 8"
assert_env_value "$GEMMA4_31B_JSON" "VLLM_USE_V2_MODEL_RUNNER" "1" "gemma4-31b runs the V2 model runner (the draft mixes sliding and full attention)"
assert_command_lacks_flag "$GEMMA4_31B_JSON" "--quantization" "gemma4-31b takes its quantization from the checkpoint (online fp8 broke the dense lane)"
assert_flag_value "$GEMMA4_31B_JSON" "--kv-cache-dtype" "auto" "gemma4-31b leaves the KV dtype to its config copy (BF16)"
assert_flag_value "$GEMMA4_31B_JSON" "--hf-config-path" "/workspace/gemma4-31b-nvfp4-config" "gemma4-31b reads the config copy without the uncalibrated fp8 KV scheme"
assert_volume_mount "$GEMMA4_31B_JSON" "$REPO_DIR/shared/gemma4-31b-nvfp4-config" "/workspace/gemma4-31b-nvfp4-config" "gemma4-31b mounts its config copy"
assert_equals "$(jq -r '.quantization_config | (.quant_algo + "/" + ((.kv_cache_scheme // "none") | tostring))' "$REPO_DIR/shared/gemma4-31b-nvfp4-config/config.json")" "NVFP4/none" "gemma4-31b config copy keeps NVFP4 and drops the KV scheme"
assert_repo_file "shared/gemma4-31b-nvfp4-config/generation_config.json" "gemma4-31b config copy keeps the checkpoint's sampling defaults"
assert_command_has_flag "$GEMMA4_31B_JSON" "--no-scheduler-reserve-full-isl" "gemma4-31b turns off the full-prompt admission gate that stalls long prompts"

# Every model lane: no egress, no capabilities, no setuid gain, Hugging Face offline from a
# read-only ./models.
UNHARDENED_LANES="$(jq -r '.services | to_entries[]
  | select((.value.container_name // "") | startswith("vllm-"))
  | select(.key | test("^(waker|request-validator|api-gateway)$") | not)
  | select(((.value.cap_drop // []) | join(",")) != "ALL"
      or ((.value.security_opt // []) | index("no-new-privileges:true")) == null
      or ((.value.networks // {}) | keys | join(",")) != "vllm_internal"
      or (.value.environment.HF_HUB_OFFLINE // "") != "1"
      or (.value.environment.HF_HUB_CACHE // "") != "/models"
      or ([.value.volumes[]? | select(.target == "/models") | .read_only] | first) != true)
  | .value.container_name' "$ACTIVE_JSON" | tr '\n' ' ')"
assert_equals "${UNHARDENED_LANES% }" "" "every model lane drops capabilities, sets no-new-privileges, has no egress and runs Hugging Face offline from a read-only ./models"
# Caches hold code a lane runs; a shared writable mount would let one lane plant code in another.
SHARED_WRITABLE_MOUNTS="$(jq -r '[.services | to_entries[]
  | select((.value.container_name // "") | startswith("vllm-"))
  | select(.key | test("^(waker|request-validator|api-gateway)$") | not)
  | .value.container_name as $c
  | (.value.volumes // [])[] | select(.type == "bind" and (.read_only // false) != true)
  | {s: .source, c: $c}]
  | group_by(.s) | map(select(length > 1) | "\(.[0].s) (\(map(.c) | join(",")))") | .[]' "$ACTIVE_JSON" | tr '\n' ' ')"
assert_equals "${SHARED_WRITABLE_MOUNTS% }" "" "no two lanes share a writable mount"
# Every lane resolves to Hugging Face snapshots that tools/download-weights.sh can fetch.
UNRESOLVED_LANES=""
for model_id in $(jq -r 'keys[]' "$MODELS_FILE"); do
  if ! service_json="$(resolve_service_json "$ACTIVE_JSON" "$model_id" 2>/dev/null)" ||
    ! service_weight_targets "$service_json" >/dev/null; then
    UNRESOLVED_LANES+="$model_id "
  fi
done
assert_equals "${UNRESOLVED_LANES% }" "" "every lane's weights resolve to Hugging Face snapshots for tools/download-weights.sh"
# vLLM writes a lock file into --download-dir, and lanes cannot write to ./models.
LANES_WITH_DOWNLOAD_DIR="$(jq -r '.services[]
  | select((.command // []) | index("--download-dir") != null)
  | .container_name' "$ACTIVE_JSON" | tr '\n' ' ')"
assert_equals "${LANES_WITH_DOWNLOAD_DIR% }" "" "no lane passes --download-dir, so vLLM never writes into ./models"
# With no default route vLLM detects its IP as 0.0.0.0 and Ray never places the worker.
RAY_LANES_WITHOUT_HOST_IP="$(jq -r '.services | to_entries[]
  | select((.value.command // []) | index(["ray"]) != null)
  | select((.value.environment.VLLM_HOST_IP // "") == "")
  | .value.container_name' "$ACTIVE_JSON" | tr '\n' ' ')"
assert_equals "${RAY_LANES_WITHOUT_HOST_IP% }" "" "every Ray-executor lane pins VLLM_HOST_IP for the internal network"

if [[ "$FAILURES" -ne 0 ]]; then
  echo
  echo "Validation failed: $FAILURES of $CHECKS checks failed" >&2
  exit 1
fi

echo
echo "OK: $CHECKS curated compose assertions passed"
