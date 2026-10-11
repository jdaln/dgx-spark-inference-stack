#!/usr/bin/env bash
# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
# Download the tiktoken encodings, with sha256 checks, into tiktoken_encodings/ of an
# upstream spark-vllm-docker clone. vendor-tiktoken.patch COPYs them instead of the
# mid-build wget, which fails often.
#
#   bash custom-docker-containers/vllm-node-dflash2/fetch-tiktoken.sh tmp/spark-vllm-docker

set -euo pipefail

clone_dir="${1:-tmp/spark-vllm-docker}"
[[ -d "$clone_dir" ]] || { echo "not a directory: $clone_dir" >&2; exit 1; }

dest="$clone_dir/tiktoken_encodings"
mkdir -p "$dest"

# name  url  sha256
files=(
  "cl100k_base.tiktoken https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken 223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7"
  "o200k_base.tiktoken https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken 446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d"
)

for entry in "${files[@]}"; do
    read -r name url want <<<"$entry"
    target="$dest/$name"

    if [[ -f "$target" ]] && [[ "$(sha256sum "$target" | cut -d' ' -f1)" == "$want" ]]; then
        echo "ok (cached): $name"
        continue
    fi

    echo "fetching: $name"
    curl -fSL --retry 5 --retry-delay 5 -o "$target.tmp" "$url"

    got="$(sha256sum "$target.tmp" | cut -d' ' -f1)"
    if [[ "$got" != "$want" ]]; then
        rm -f "$target.tmp"
        echo "checksum mismatch for $name: got $got, want $want" >&2
        exit 1
    fi

    mv "$target.tmp" "$target"
    echo "ok: $name"
done
