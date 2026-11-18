#!/usr/bin/env bash
# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
# Download lanes' pinned weights, and any draft model named in --speculative-config, into
# ./models. Lanes run offline, so this is the only download path. It runs the hf CLI in a
# temporary container with network access, from the lane's own image or another built
# runtime image. Set HF_TOKEN for gated repositories.
#
#   bash tools/download-weights.sh --list                    # every lane: weights, image
#   bash tools/download-weights.sh <model-id>... [--dry-run]
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

usage() {
  echo "usage: download-weights.sh --list" >&2
  echo "       download-weights.sh <model-id>... [--dry-run]" >&2
  exit 2
}
MODEL_IDS=()
DRY_RUN=0
LIST=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --list) LIST=1 ;;
    -*) usage ;;
    *) MODEL_IDS+=("$arg") ;;
  esac
done
[[ "$LIST" -eq 1 || "${#MODEL_IDS[@]}" -gt 0 ]] || usage
require_cmd docker jq node

TMP_DIR="$(make_workspace_tmp_dir download-weights)"
trap 'rm -rf "$TMP_DIR"' EXIT
render_active_compose_json "$TMP_DIR/compose.json"

image_built() { docker image inspect "$1" >/dev/null 2>&1; }

if [[ "$LIST" -eq 1 ]]; then
  printf '%-62s %-8s %-6s %s\n' MODEL WEIGHTS IMAGE SNAPSHOTS
  for model_id in $(jq -r 'keys[]' "$MODELS_FILE"); do
    service_json="$(resolve_service_json "$TMP_DIR/compose.json" "$model_id" 2>/dev/null)" || continue
    weights=missing
    if model_weights_present "$service_json"; then weights=present; fi
    image_status=none
    if image_built "$(jq -r '.image' <<<"$service_json")"; then image_status=built; fi
    snapshots="$(service_weight_targets "$service_json" 2>/dev/null | sed -E 's/@([0-9a-f]{7})[0-9a-f]+$/@\1/; s/@$//' | paste -sd ' ' -)"
    printf '%-62s %-8s %-6s %s\n' "$model_id" "$weights" "$image_status" "$snapshots"
  done
  exit 0
fi

# Run in the lane's own image when its hf CLI works, else in another built runtime image.
has_hf() { docker run --rm --network none --entrypoint hf "$1" version >/dev/null 2>&1; }
FALLBACK_IMAGE=""
pick_image() {
  local img
  IMAGE="$1"
  if image_built "$IMAGE" && has_hf "$IMAGE"; then return 0; fi
  if [[ -z "$FALLBACK_IMAGE" ]]; then
    for img in $(jq -r '[.services[] | select((.profiles // []) | index("models")) | .image // empty] | unique[]' "$TMP_DIR/compose.json"); do
      [[ "$img" == "$1" ]] && continue
      if image_built "$img" && has_hf "$img"; then FALLBACK_IMAGE="$img"; break; fi
    done
  fi
  IMAGE="$FALLBACK_IMAGE"
  [[ -n "$IMAGE" ]]
}

# Maya serves from a pack (tensor index, small float weights, tokenizer) that sits in the folder
# of its GGUF files. Lanes cannot write ./models, so the pack is built here, in the lane image
# with no network.
build_maya_pack() {
  local model_id="$1" service_json="$2" image dir pack
  image="$(jq -r '.image' <<<"$service_json")"
  dir="$(service_model_ref "$service_json")"
  pack="$(command_flag_value "$service_json" "--glm-pack")"
  echo "$model_id: maya-lane-pack --model-path $dir --glm-pack $pack  (image $image, no network)"
  [[ "$DRY_RUN" -eq 1 ]] && return 0
  if [[ -e "$MODELS_DIR/${pack#/models/}" ]]; then
    echo "$model_id: pack already built"
    return 0
  fi
  if ! image_built "$image"; then
    echo "$model_id: the pack is built in $image, which is not built yet. Build it, then run this again." >&2
    return 0
  fi
  docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges:true --read-only \
    --tmpfs /tmp -v "$MODELS_DIR:/models" "$image" \
    maya-lane-pack --model-path "$dir" --glm-pack "$pack" || true
}

failed=()
for model_id in "${MODEL_IDS[@]}"; do
  if ! service_json="$(resolve_service_json "$TMP_DIR/compose.json" "$model_id")"; then
    failed+=("$model_id")
    continue
  fi
  mapfile -t targets < <(service_weight_targets "$service_json" || true)
  if [[ "${#targets[@]}" -eq 0 ]]; then
    echo "$model_id serves $(service_model_ref "$service_json"), which is not a Hugging Face snapshot; provision it by hand." >&2
    failed+=("$model_id")
    continue
  fi
  if ! pick_image "$(jq -r '.image' <<<"$service_json")"; then
    echo "No built runtime image has a working hf CLI, and the download runs in one. Build one first (README, step 3)." >&2
    exit 1
  fi

  # A lane that serves one folder of a repository (a GGUF variant) fetches that folder and the
  # other files its command names, not the whole repository.
  mapfile -t includes < <(service_weight_includes "$service_json")
  for i in "${!targets[@]}"; do
    target="${targets[$i]}"
    repo="${target%@*}"
    revision="${target##*@}"
    args=(download "$repo" --cache-dir /models)
    [[ -n "$revision" ]] && args+=(--revision "$revision")
    if [[ "$i" -eq 0 ]]; then
      for include in "${includes[@]}"; do args+=(--include "$include"); done
    fi
    echo "$model_id: hf ${args[*]}  (image $IMAGE)"
    [[ "$DRY_RUN" -eq 1 ]] && continue
    env_args=()
    [[ -n "${HF_TOKEN:-}" ]] && env_args+=(-e HF_TOKEN)
    # A failed download shows up in the snapshot check below.
    docker run --rm "${env_args[@]}" -v "$MODELS_DIR:/models" --entrypoint hf "$IMAGE" "${args[@]}" || true
    # hf 1.x writes each attempt to its own <etag>.<id>.incomplete and never resumes one, so an
    # interrupted run leaves dead partials behind. Drop those whose blob is now complete.
    docker run --rm --network none -v "$MODELS_DIR:/models" --entrypoint sh "$IMAGE" -c '
      for f in "$1"/*.incomplete; do
        [ -e "$f" ] || continue
        blob="${f%.incomplete}"
        [ -e "$blob" ] || [ -e "${blob%.*}" ] || continue
        rm -f "$f" && echo "removed dead partial download ${f##*/}"
      done' sh "/models/models--${repo//\//--}/blobs" || true
  done

  if [[ "$(jq -r --arg m "$model_id" '.[$m].backend // "vllm"' "$MODELS_FILE")" == maya ]]; then
    build_maya_pack "$model_id" "$service_json"
  fi

  [[ "$DRY_RUN" -eq 1 ]] && continue
  if model_weights_present "$service_json"; then
    echo "OK: $model_id has complete snapshots in ./models"
  else
    echo "FAILED: ./models still lacks complete weights for $model_id." >&2
    failed+=("$model_id")
  fi
done

if [[ "${#failed[@]}" -gt 0 ]]; then
  echo "Not provisioned: ${failed[*]}" >&2
  exit 1
fi
