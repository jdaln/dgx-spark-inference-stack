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
# A sharded snapshot whose index names two shards, one not yet downloaded.
make_snapshot org--sharded sss no
SHARDED="$MODELS_DIR/models--org--sharded"
echo '{"weight_map":{"a":"model-00001-of-00002.safetensors","b":"model-00002-of-00002.safetensors"}}' \
  > "$SHARDED/snapshots/sss/model.safetensors.index.json"
: > "$SHARDED/blobs/shard-1"
ln -s ../../blobs/shard-1 "$SHARDED/snapshots/sss/model-00001-of-00002.safetensors"
expect "present: sharded, one shard missing" "no" "$(status model_weights_present "$(svc vllm serve org/sharded --revision sss)")"
: > "$SHARDED/blobs/shard-2"
ln -s ../../blobs/shard-2 "$SHARDED/snapshots/sss/model-00002-of-00002.safetensors"
expect "present: sharded, all shards" "yes" "$(status model_weights_present "$(svc vllm serve org/sharded --revision sss)")"
make_snapshot org--draft ddd yes
expect "present: with its draft" "yes" \
  "$(status model_weights_present "$(svc vllm serve org/model --revision aaa --speculative-config '{"model":"org/draft","revision":"ddd"}')")"
expect "present: draft missing" "no" \
  "$(status model_weights_present "$(svc vllm serve org/model --revision aaa --speculative-config '{"model":"org/draft","revision":"eee"}')")"
expect "present: path-served model, draft missing" "no" \
  "$(status model_weights_present "$(svc vllm serve /models/models--org--model/snapshots/aaa --speculative-config '{"model":"org/absent"}')")"

# A GGUF repository: no config.json, one folder of split files per variant, served by path.
GGUF="$MODELS_DIR/models--org--gguf"
TIER="$GGUF/snapshots/ggg/Tier-S"
mkdir -p "$TIER" "$GGUF/blobs"
for part in 1 2; do
  : > "$GGUF/blobs/part-$part"
  ln -s "../../../blobs/part-$part" "$TIER/m-0000$part-of-00003.gguf"
done
TIER_PATH=/models/models--org--gguf/snapshots/ggg/Tier-S
GGUF_SVC="$(svc engine --model-path "$TIER_PATH")"
expect "targets: folder of a snapshot" "org/gguf@ggg" "$(service_weight_targets "$GGUF_SVC")"
expect "subdir: folder of a snapshot" "Tier-S" "$(service_weight_subdir "$GGUF_SVC")"
expect "subdir: snapshot root" "" "$(service_weight_subdir "$(svc vllm serve /models/models--org--model/snapshots/aaa)")"
expect "subdir: repo id" "" "$(service_weight_subdir "$SERVE")"
expect "includes: the served folder only" "Tier-S/*" "$(service_weight_includes "$GGUF_SVC")"
expect "includes: whole repository when served from the snapshot root" "" \
  "$(service_weight_includes "$(svc vllm serve /models/models--org--model/snapshots/aaa)")"
# A pack inside the served folder is built there, not downloaded; another file of the snapshot is.
expect "includes: plus other files of the snapshot the command names" $'Tier-S/*\nextras/direction.gguf' \
  "$(service_weight_includes "$(svc engine --model-path "$TIER_PATH" --pack "$TIER_PATH/pack" --direction /models/models--org--gguf/snapshots/ggg/extras/direction.gguf --other /models/models--org--else/snapshots/eee/x.gguf)")"
expect "present: GGUF folder, a part missing" "no" "$(status model_weights_present "$GGUF_SVC")"
: > "$GGUF/blobs/part-3"
ln -s ../../../blobs/part-3 "$TIER/m-00003-of-00003.gguf"
expect "present: GGUF folder, all parts" "yes" "$(status model_weights_present "$GGUF_SVC")"
ln -s ../../../blobs/absent "$TIER/other.gguf"
expect "present: GGUF folder, dangling link" "no" "$(status model_weights_present "$GGUF_SVC")"
rm "$TIER/other.gguf"
mkdir -p "$GGUF/snapshots/ggg/Empty"
expect "present: folder without GGUF files" "no" \
  "$(status model_weights_present "$(svc engine --model-path /models/models--org--gguf/snapshots/ggg/Empty)")"
# Any other /models path the command names must exist: here a pack built beside the weights.
PACK_SVC="$(svc engine --model-path "$TIER_PATH" --pack "$TIER_PATH/pack")"
expect "present: named pack missing" "no" "$(status model_weights_present "$PACK_SVC")"
mkdir "$TIER/pack"
expect "present: named pack built" "yes" "$(status model_weights_present "$PACK_SVC")"

echo
if [[ "$FAILURES" -ne 0 ]]; then
  echo "FAILED: $FAILURES of $CHECKS weight-helper checks" >&2
  exit 1
fi
echo "OK: $CHECKS weight-helper checks passed"
