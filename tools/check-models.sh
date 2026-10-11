#!/usr/bin/env bash
# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

MODELS_FILE="${1:-$REPO_DIR/models.json}"
COMPOSE_FILE="${2:-$REPO_DIR/docker-compose.yml}"
COMPOSE_DIR="$(cd -- "$(dirname -- "$COMPOSE_FILE")" && pwd)"

if [[ ! -f "$MODELS_FILE" ]]; then
  echo "Missing models file: $MODELS_FILE" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Missing compose file: $COMPOSE_FILE" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to parse $MODELS_FILE" >&2
  exit 1
fi

SEARCH_TOOL="grep"
if command -v rg >/dev/null 2>&1; then
  SEARCH_TOOL="rg"
fi

TMP_DIR="$(make_workspace_tmp_dir check-models)"
trap 'rm -rf "$TMP_DIR"' EXIT

INCLUDE_LIST="$TMP_DIR/include-list.txt"
COMPOSE_CONTAINERS_RAW="$TMP_DIR/compose-containers-raw.txt"
COMPOSE_CONTAINERS="$TMP_DIR/compose-containers.txt"
MODELS_CONTAINERS_RAW="$TMP_DIR/models-containers-raw.txt"
MODELS_CONTAINERS="$TMP_DIR/models-containers.txt"
COMPOSE_DUPES="$TMP_DIR/compose-dupes.txt"
MODELS_DUPES="$TMP_DIR/models-dupes.txt"
ONLY_IN_COMPOSE="$TMP_DIR/only-in-compose.txt"
ONLY_IN_MODELS="$TMP_DIR/only-in-models.txt"

if [[ "$SEARCH_TOOL" == "rg" ]]; then
  rg --no-filename '^[[:space:]]*-[[:space:]]+compose/models-[^[:space:]]+\.yml[[:space:]]*$' "$COMPOSE_FILE" \
    | sed -E 's/^[[:space:]]*-[[:space:]]+//' \
    | LC_ALL=C sort -u > "$INCLUDE_LIST"
else
  grep -E '^[[:space:]]*-[[:space:]]+compose/models-[^[:space:]]+\.yml[[:space:]]*$' "$COMPOSE_FILE" \
    | sed -E 's/^[[:space:]]*-[[:space:]]+//' \
    | LC_ALL=C sort -u > "$INCLUDE_LIST"
fi

if [[ ! -s "$INCLUDE_LIST" ]]; then
  echo "No active model includes found in $COMPOSE_FILE" >&2
  exit 1
fi

while IFS= read -r relative_path; do
  compose_fragment="$COMPOSE_DIR/$relative_path"
  if [[ ! -f "$compose_fragment" ]]; then
    echo "Missing included compose fragment: $relative_path" >&2
    exit 1
  fi

  if [[ "$SEARCH_TOOL" == "rg" ]]; then
    rg --no-filename '^[[:space:]]*container_name:[[:space:]]*[^[:space:]]+[[:space:]]*$' "$compose_fragment" \
      | sed -E 's/^[[:space:]]*container_name:[[:space:]]*//'
  else
    grep -E '^[[:space:]]*container_name:[[:space:]]*[^[:space:]]+[[:space:]]*$' "$compose_fragment" \
      | sed -E 's/^[[:space:]]*container_name:[[:space:]]*//'
  fi
done < "$INCLUDE_LIST" > "$COMPOSE_CONTAINERS_RAW"

node --input-type=module - "$MODELS_FILE" > "$MODELS_CONTAINERS_RAW" <<'EOF'
import { readFileSync } from "node:fs";

const filePath = process.argv[2];
const data = JSON.parse(readFileSync(filePath, "utf8"));

for (const value of Object.values(data)) {
  if (value && typeof value.container === "string" && value.container.trim()) {
    console.log(value.container.trim());
  }
}
EOF

LC_ALL=C sort "$COMPOSE_CONTAINERS_RAW" > "$COMPOSE_CONTAINERS"
LC_ALL=C sort "$MODELS_CONTAINERS_RAW" > "$MODELS_CONTAINERS"
LC_ALL=C sort "$COMPOSE_CONTAINERS_RAW" | uniq -d > "$COMPOSE_DUPES"
LC_ALL=C sort "$MODELS_CONTAINERS_RAW" | uniq -d > "$MODELS_DUPES"

if [[ -s "$COMPOSE_DUPES" ]]; then
  echo "Duplicate compose container_name values:" >&2
  cat "$COMPOSE_DUPES" >&2
  exit 1
fi

if [[ -s "$MODELS_DUPES" ]]; then
  echo "Duplicate models.json container values:" >&2
  cat "$MODELS_DUPES" >&2
  exit 1
fi

comm -23 "$COMPOSE_CONTAINERS" "$MODELS_CONTAINERS" > "$ONLY_IN_COMPOSE"
comm -13 "$COMPOSE_CONTAINERS" "$MODELS_CONTAINERS" > "$ONLY_IN_MODELS"

compose_count="$(wc -l < "$COMPOSE_CONTAINERS" | tr -d ' ')"
models_count="$(wc -l < "$MODELS_CONTAINERS" | tr -d ' ')"

echo "Compared active compose model containers to models.json"
echo "Compose fragments:"
sed 's/^/- /' "$INCLUDE_LIST"
echo "Compose containers: $compose_count"
echo "models.json containers: $models_count"

if [[ -s "$ONLY_IN_COMPOSE" || -s "$ONLY_IN_MODELS" ]]; then
  if [[ -s "$ONLY_IN_COMPOSE" ]]; then
    echo
    echo "Only in compose:" >&2
    sed 's/^/- /' "$ONLY_IN_COMPOSE" >&2
  fi

  if [[ -s "$ONLY_IN_MODELS" ]]; then
    echo
    echo "Only in models.json:" >&2
    sed 's/^/- /' "$ONLY_IN_MODELS" >&2
  fi

  exit 1
fi

# Beyond names: served name, context length, models profile, waker prefix and
# speculativeDecoding must match too.
COMPOSE_JSON="$TMP_DIR/compose.json"
compose_cmd --profile models -f "$COMPOSE_FILE" config --format json > "$COMPOSE_JSON"

node --input-type=module - "$MODELS_FILE" "$COMPOSE_JSON" <<'EOF'
import { readFileSync } from "node:fs";

const [modelsPath, composePath] = process.argv.slice(2);
const models = JSON.parse(readFileSync(modelsPath, "utf8"));
const services = Object.values(JSON.parse(readFileSync(composePath, "utf8")).services ?? {});
const flag = (command, name) => {
  const index = command.indexOf(name);
  return index === -1 ? null : command[index + 1] ?? null;
};

const problems = [];
for (const [modelId, entry] of Object.entries(models)) {
  const service = services.find((candidate) => candidate.container_name === entry.container);
  if (!service) continue;
  const command = (service.command ?? []).map(String);
  const served = flag(command, "--served-model-name");
  if (served !== null && served !== modelId) {
    problems.push(`${modelId}: --served-model-name is '${served}'`);
  }
  const maxLen = flag(command, "--max-model-len") ?? flag(command, "--context-length");
  if (maxLen !== null && /^\d+$/.test(maxLen) && Number(maxLen) !== entry.maxModelLen) {
    problems.push(`${modelId}: serves ${maxLen} tokens, models.json says ${entry.maxModelLen}`);
  }
  if (!(service.profiles ?? []).includes("models")) {
    problems.push(`${modelId}: service lacks the 'models' profile`);
  }
  if (!entry.container.startsWith("vllm-")) {
    problems.push(`${modelId}: container '${entry.container}' lacks the vllm- prefix the waker manages`);
  }
  // The validator rejects min_p/logit_bias on speculative lanes, so the flag must track compose.
  const speculative = command.includes("--speculative-config");
  if (speculative !== (entry.speculativeDecoding === true)) {
    problems.push(`${modelId}: ${speculative ? "runs" : "does not run"} speculative decoding, models.json speculativeDecoding is ${entry.speculativeDecoding === true}`);
  }
}

if (problems.length > 0) {
  console.error("models.json and compose disagree:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
EOF

echo
echo "OK: compose and models.json agree"
