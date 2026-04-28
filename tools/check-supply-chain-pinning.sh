#!/usr/bin/env bash

set -euo pipefail
shopt -s nullglob globstar

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

declare -a failures=()

add_failure() {
    failures+=("$1")
}

normalize_ref() {
    printf '%s' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^"//; s/"$//; s/^\x27//; s/\x27$//'
}

unwrap_default_image() {
    local ref="$1"

    if [[ "$ref" =~ ^\$\{[^:}]+:-([^}]+)\}$ ]]; then
        printf '%s' "${BASH_REMATCH[1]}"
        return
    fi

    printf '%s' "$ref"
}

is_local_image() {
    local ref="$1"

    [[ -z "$ref" ]] && return 0
    [[ "$ref" == local/* ]] && return 0
    [[ "$ref" == vllm-* ]] && return 0
    [[ "$ref" == waker* ]] && return 0
    [[ "$ref" == request-validator* ]] && return 0

    return 1
}

check_compose_images() {
    local file line line_number ref
    local compose_files=(docker-compose.yml compose/*.yml)

    for file in "${compose_files[@]}"; do
        [[ -f "$file" ]] || continue
        line_number=0
        while IFS= read -r line; do
            line_number=$((line_number + 1))
            [[ "$line" =~ ^[[:space:]]*# ]] && continue

            if [[ "$line" =~ ^[[:space:]]*image:[[:space:]]+(.+)$ ]]; then
                ref="${BASH_REMATCH[1]}"
                ref="${ref%%#*}"
                ref="$(normalize_ref "$ref")"
                ref="$(unwrap_default_image "$ref")"
                ref="$(normalize_ref "$ref")"

                if is_local_image "$ref"; then
                    continue
                fi

                if [[ "$ref" != *"@sha256:"* ]]; then
                    add_failure "$file:$line_number external compose image is not digest-pinned: $ref"
                fi
            fi
        done < "$file"
    done
}

check_dockerfile_images() {
    local file line line_number from alias arg_name arg_value
    local dockerfiles=(
        custom-docker-containers/**/Dockerfile
        request-validator/Dockerfile
        tools/streaming-proxy/Dockerfile
        waker/Dockerfile
    )

    for file in "${dockerfiles[@]}"; do
        [[ -f "$file" ]] || continue
        line_number=0
        declare -A stages=()

        while IFS= read -r line; do
            line_number=$((line_number + 1))
            [[ "$line" =~ ^[[:space:]]*# ]] && continue

            if [[ "$line" =~ ^[[:space:]]*ARG[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)=(.+)$ ]]; then
                arg_name="${BASH_REMATCH[1]}"
                arg_value="${BASH_REMATCH[2]}"
                arg_value="${arg_value%%[[:space:]]*}"
                arg_value="$(normalize_ref "$arg_value")"

                if [[ "$arg_name" == "BASE_IMAGE" || "$arg_name" == *_IMAGE ]]; then
                    if ! is_local_image "$arg_value" && [[ "$arg_value" != *"@sha256:"* ]]; then
                        add_failure "$file:$line_number Dockerfile ARG $arg_name is external but not digest-pinned: $arg_value"
                    fi
                fi
            fi

            if [[ "$line" =~ ^[[:space:]]*FROM[[:space:]]+([^[:space:]]+)([[:space:]]+[Aa][Ss][[:space:]]+([A-Za-z0-9._-]+))? ]]; then
                from="${BASH_REMATCH[1]}"
                alias="${BASH_REMATCH[3]:-}"

                if [[ "$from" != \$\{* ]] && [[ -z "${stages[$from]+x}" ]] && ! is_local_image "$from"; then
                    if [[ "$from" != *"@sha256:"* ]]; then
                        add_failure "$file:$line_number Dockerfile FROM is external but not digest-pinned: $from"
                    fi
                fi

                if [[ -n "$alias" ]]; then
                    stages["$alias"]=1
                fi
            fi
        done < "$file"
    done
}

check_workflow_actions() {
    local file line line_number ref
    local workflow_files=(.github/workflows/*.yml)

    for file in "${workflow_files[@]}"; do
        [[ -f "$file" ]] || continue
        line_number=0
        while IFS= read -r line; do
            line_number=$((line_number + 1))
            if [[ "$line" =~ ^[[:space:]]*uses:[[:space:]]+([^[:space:]]+) ]]; then
                ref="${BASH_REMATCH[1]}"
                [[ "$ref" == ./* ]] && continue
                if [[ ! "$ref" =~ @[0-9a-f]{40}$ ]]; then
                    add_failure "$file:$line_number GitHub Action is not pinned to a commit SHA: $ref"
                fi
            fi
        done < "$file"
    done
}

check_workflow_inline_images() {
    local file line line_number pending_line remaining_lines have_annotation
    local annotation_line annotation_remaining_lines last_annotated_image_line
    local workflow_files=(.github/workflows/*.yml)

    for file in "${workflow_files[@]}"; do
        [[ -f "$file" ]] || continue
        line_number=0
        pending_line=0
        remaining_lines=0
        have_annotation=0
        annotation_line=0
        annotation_remaining_lines=0
        last_annotated_image_line=0

        while IFS= read -r line; do
            line_number=$((line_number + 1))

            if [[ "$line" == *"# renovate: datasource=docker"* ]]; then
                annotation_line=$line_number
                annotation_remaining_lines=3
                continue
            fi

            if (( annotation_line > 0 )); then
                if [[ "$line" =~ @sha256:[a-f0-9]{64} ]]; then
                    if (( pending_line > 0 )); then
                        pending_line=0
                        remaining_lines=0
                        have_annotation=0
                    else
                        last_annotated_image_line=$line_number
                    fi
                    annotation_line=0
                    annotation_remaining_lines=0
                else
                    annotation_remaining_lines=$((annotation_remaining_lines - 1))
                    if (( annotation_remaining_lines == 0 )); then
                        add_failure "$file:$annotation_line docker workflow annotation is missing a digest-pinned image reference"
                        annotation_line=0
                    fi
                fi
            fi

            if [[ "$line" == *"docker run"* ]]; then
                if (( last_annotated_image_line > 0 )) && (( line_number - last_annotated_image_line <= 6 )); then
                    last_annotated_image_line=0
                    continue
                fi

                if (( pending_line > 0 )); then
                    add_failure "$file:$pending_line docker run is missing a pinned inline image"
                fi
                pending_line=$line_number
                remaining_lines=6
                have_annotation=0
                continue
            fi

            if (( pending_line == 0 )); then
                continue
            fi

            if (( have_annotation > 0 )) && [[ "$line" =~ @sha256:[a-f0-9]{64} ]]; then
                pending_line=0
                remaining_lines=0
                have_annotation=0
                continue
            fi

            remaining_lines=$((remaining_lines - 1))
            if (( remaining_lines == 0 )); then
                add_failure "$file:$pending_line docker run is missing a Renovate-annotated, digest-pinned inline image"
                pending_line=0
                have_annotation=0
            fi
        done < "$file"

        if (( pending_line > 0 )); then
            add_failure "$file:$pending_line docker run is missing a Renovate-annotated, digest-pinned inline image"
        fi

        if (( annotation_line > 0 )); then
            add_failure "$file:$annotation_line docker workflow annotation is missing a digest-pinned image reference"
        fi
    done
}

check_compose_images
check_dockerfile_images
check_workflow_actions
check_workflow_inline_images

if (( ${#failures[@]} > 0 )); then
    printf 'Supply-chain pinning check failed:\n' >&2
    printf ' - %s\n' "${failures[@]}" >&2
    exit 1
fi

printf 'Supply-chain pinning check passed.\n'
