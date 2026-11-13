// Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
// Which Hugging Face snapshots a lane's command needs that the models directory lacks. Lanes
// run offline from /models, so a lane missing one can only fail to start. Mirrors
// service_weight_targets and model_weights_present in tools/lib/common.sh.
import fs from "node:fs";
import path from "node:path";

const WEIGHT_FILE = /\.(safetensors|gguf|bin)$/;
const SHARD_INDEX = "model.safetensors.index.json";

function flagValue(command, flag) {
  const i = command.indexOf(flag);
  return i >= 0 && i + 1 < command.length ? command[i + 1] : "";
}

// The served model and any draft model named in --speculative-config.
export function weightTargets(command) {
  const s = command.indexOf("serve");
  const ref = s >= 0 && s + 1 < command.length && !command[s + 1].startsWith("-")
    ? command[s + 1]
    : flagValue(command, "--model") || flagValue(command, "--model-path");
  if (!ref) return [];
  const targets = [{ ref, revision: flagValue(command, "--revision") }];
  const spec = flagValue(command, "--speculative-config");
  if (spec) {
    try {
      const draft = JSON.parse(spec);
      if (typeof draft.model === "string" && draft.model) targets.push({ ref: draft.model, revision: draft.revision || "" });
    } catch { /* vLLM rejects a malformed config itself */ }
  }
  return targets;
}

// config.json plus a weight file; symlinks into blobs/ must resolve. A sharded checkpoint
// needs every shard its index names: an interrupted download leaves some.
function snapshotComplete(dir) {
  try {
    if (!fs.existsSync(path.join(dir, "config.json"))) return false;
    const index = path.join(dir, SHARD_INDEX);
    if (fs.existsSync(index)) {
      const shards = new Set(Object.values(JSON.parse(fs.readFileSync(index, "utf8")).weight_map || {}));
      return shards.size > 0 && [...shards].every((f) => fs.existsSync(path.join(dir, f)));
    }
    return fs.readdirSync(dir).some((f) => WEIGHT_FILE.test(f) && fs.existsSync(path.join(dir, f)));
  } catch {
    return false;
  }
}

function targetPresent({ ref, revision }, modelsDir) {
  if (ref.startsWith("/models/")) return snapshotComplete(path.join(modelsDir, ref.slice("/models/".length)));
  // A path outside the models mount is not the waker's to check.
  if (ref.startsWith("/")) return true;
  const snapshots = path.join(modelsDir, `models--${ref.replaceAll("/", "--")}`, "snapshots");
  if (revision) return snapshotComplete(path.join(snapshots, revision));
  try {
    return fs.readdirSync(snapshots).some((rev) => snapshotComplete(path.join(snapshots, rev)));
  } catch {
    return false;
  }
}

// "repo@revision", or the path, of each target missing from modelsDir.
export function missingWeights(command, modelsDir) {
  return weightTargets(command)
    .filter((t) => !targetPresent(t, modelsDir))
    .map((t) => (t.revision ? `${t.ref}@${t.revision}` : t.ref));
}
