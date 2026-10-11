#!/usr/bin/env bash
# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
#
# Check out one commit of a git repository, keeping a bare copy in a build cache mount so
# later builds only download new objects.
#
#   fetch-pinned URL COMMIT DEST CACHE [submodules]
set -euo pipefail

url=$1
commit=$2
dest=$3
cache=$4
submodules=${5:-}

# Three tries, five seconds apart.
with_retries() {
    local n
    for n in 1 2 3; do
        "$@" && return 0
        [[ $n -lt 3 ]] && sleep 5
    done
    return 1
}

if [[ "$(git -C "$cache" rev-parse --is-bare-repository 2>/dev/null)" == "true" ]]; then
    git -C "$cache" remote set-url origin "$url"
    with_retries git -C "$cache" fetch --quiet --tags origin '+refs/heads/*:refs/heads/*' ||
        echo "fetch-pinned: fetch of $url failed, using the cached copy" >&2
else
    # The cache is a mount point: empty it, do not remove it.
    mkdir -p "$cache"
    find "$cache" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    with_retries git clone --quiet --bare "$url" "$cache"
fi

# A commit that is on no branch can still be fetched by its hash.
if ! git -C "$cache" cat-file -e "$commit^{commit}" 2>/dev/null; then
    with_retries git -C "$cache" fetch --quiet origin "$commit"
fi

rm -rf "$dest"
git clone --quiet --no-hardlinks --no-checkout "$cache" "$dest"
git -C "$dest" remote set-url origin "$url"
git -C "$dest" checkout --quiet --detach "$commit"

if [[ "$submodules" == "submodules" ]]; then
    with_retries git -C "$dest" submodule update --quiet --init --recursive
fi
