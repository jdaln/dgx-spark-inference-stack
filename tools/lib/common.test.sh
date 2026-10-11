#!/usr/bin/env bash
# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
# Offline checks for the weight helpers in common.sh against a fixture models tree. These
# decide whether run-model, smoke and test-lane start a lane and what download-weights fetches.
#
#   bash tools/lib/common.test.sh
set -euo pipefail

TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$TEST_DIR/../../tmp"
FIXTURE="$(mktemp -d "$TEST_DIR/../../tmp/common-test.XXXXXX")"
trap 'rm -rf "$FIXTURE"' EXIT
export MODELS_DIR="$FIXTURE/models"
source "$TEST_DIR/common.sh"

FAILURES=0
CHECKS=0
expect() {
  local label="$1" expected="$2" actual="$3"
  CHECKS=$((CHECKS + 1))
  if [[ "$actual" == "$expected" ]]; then
    echo "OK: $label"
  else
    FAILURES=$((FAILURES + 1))
    printf 'FAIL: %s\n  expected: %q\n  actual:   %q\n' "$label" "$expected" "$actual" >&2
  fi
}
status() { if "$@" >/dev/null 2>&1; then echo yes; else echo no; fi; }
svc() { printf '%s\n' "$@" | jq -Rnc '{command: [inputs]}'; }

# A complete snapshot (config plus a weight symlinked into blobs, as hf lays it out), a
# metadata-only one, and a second revision of the complete repo that lacks weights.
make_snapshot() {
  local repo_dir="$MODELS_DIR/models--$1" rev="$2" weights="$3"
  mkdir -p "$repo_dir/snapshots/$rev" "$repo_dir/blobs"
  echo '{}' > "$repo_dir/snapshots/$rev/config.json"
  if [[ "$weights" == yes ]]; then
    : > "$repo_dir/blobs/w-$rev"
    ln -s "../../blobs/w-$rev" "$repo_dir/snapshots/$rev/model.safetensors"
  fi
}
make_snapshot org--model aaa yes
make_snapshot org--model bbb no
make_snapshot org--meta ccc no

SERVE="$(svc vllm serve org/model --revision aaa)"
expect "ref from vllm serve" "org/model" "$(service_model_ref "$SERVE")"
expect "ref from --model" "org/model" "$(service_model_ref "$(svc python3 -m vllm.entrypoints.openai.api_server --model org/model)")"
expect "ref from --model-path" "org/model" "$(service_model_ref "$(svc python3 -m sglang.launch_server --model-path org/model)")"
expect "pinned revision" "aaa" "$(service_model_revision "$SERVE")"
expect "no revision" "" "$(service_model_revision "$(svc vllm serve org/model)")"

expect "targets: served model" "org/model@aaa" "$(service_weight_targets "$SERVE")"
expect "targets: unpinned" "org/model@" "$(service_weight_targets "$(svc vllm serve org/model)")"
expect "targets: plus draft" $'org/model@aaa\norg/draft@ddd' \
  "$(service_weight_targets "$(svc vllm serve org/model --revision aaa --speculative-config '{"method":"dflash","model":"org/draft","revision":"ddd"}')")"
expect "targets: MTP has no draft" "org/model@aaa" \
  "$(service_weight_targets "$(svc vllm serve org/model --revision aaa --speculative-config '{"method":"mtp","num_speculative_tokens":4}')")"
expect "targets: snapshot served by path" "org/model@aaa" "$(service_weight_targets "$(svc vllm serve /models/models--org--model/snapshots/aaa)")"
expect "targets: local path fails" "no" "$(status service_weight_targets "$(svc vllm serve /models/custom)")"

expect "present: pinned revision with weights" "yes" "$(status model_weights_present "$SERVE")"
expect "present: pinned revision without weights" "no" "$(status model_weights_present "$(svc vllm serve org/model --revision bbb)")"
expect "present: unpinned, any complete snapshot" "yes" "$(status model_weights_present "$(svc vllm serve org/model)")"
expect "present: metadata only" "no" "$(status model_weights_present "$(svc vllm serve org/meta)")"
expect "present: missing repo" "no" "$(status model_weights_present "$(svc vllm serve org/absent)")"
expect "present: snapshot served by path" "yes" "$(status model_weights_present "$(svc vllm serve /models/models--org--model/snapshots/aaa)")"
expect "present: incomplete path" "no" "$(status model_weights_present "$(svc vllm serve /models/models--org--model/snapshots/bbb)")"
make_snapshot org--draft ddd yes
expect "present: with its draft" "yes" \
  "$(status model_weights_present "$(svc vllm serve org/model --revision aaa --speculative-config '{"model":"org/draft","revision":"ddd"}')")"
expect "present: draft missing" "no" \
  "$(status model_weights_present "$(svc vllm serve org/model --revision aaa --speculative-config '{"model":"org/draft","revision":"eee"}')")"
expect "present: path-served model, draft missing" "no" \
  "$(status model_weights_present "$(svc vllm serve /models/models--org--model/snapshots/aaa --speculative-config '{"model":"org/absent"}')")"

echo
if [[ "$FAILURES" -ne 0 ]]; then
  echo "FAILED: $FAILURES of $CHECKS weight-helper checks" >&2
  exit 1
fi
echo "OK: $CHECKS weight-helper checks passed"
