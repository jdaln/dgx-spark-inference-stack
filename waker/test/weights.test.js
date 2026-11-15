// Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { missingWeights, weightTargets } from "../weights.js";

const tmpRoot = path.resolve(process.cwd(), "..", "tmp");

async function snapshot(modelsDir, repoDir, rev, withWeights) {
  const dir = path.join(modelsDir, repoDir, "snapshots", rev);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(modelsDir, repoDir, "blobs"), { recursive: true });
  await fs.writeFile(path.join(dir, "config.json"), "{}");
  if (withWeights) {
    await fs.writeFile(path.join(modelsDir, repoDir, "blobs", `w-${rev}`), "");
    await fs.symlink(`../../blobs/w-${rev}`, path.join(dir, "model.safetensors"));
  }
}

test("weight targets come from serve, --model or --model-path, plus a named draft", () => {
  assert.deepEqual(weightTargets(["vllm", "serve", "org/m", "--revision", "aaa"]), [{ ref: "org/m", revision: "aaa" }]);
  assert.deepEqual(weightTargets(["python3", "-m", "x", "--model-path", "org/m"]), [{ ref: "org/m", revision: "" }]);
  assert.deepEqual(
    weightTargets(["vllm", "serve", "org/m", "--speculative-config", '{"method":"dflash","model":"org/d","revision":"ddd"}']),
    [{ ref: "org/m", revision: "" }, { ref: "org/d", revision: "ddd" }]
  );
  assert.deepEqual(weightTargets(["vllm", "serve", "org/m", "--speculative-config", '{"method":"mtp"}']), [{ ref: "org/m", revision: "" }]);
  assert.deepEqual(weightTargets(["bash", "-c", "vllm serve org/m"]), []);
});

test("missing weights are reported per target", async () => {
  await fs.mkdir(tmpRoot, { recursive: true });
  const modelsDir = await fs.mkdtemp(path.join(tmpRoot, "waker-weights-test-"));
  try {
    await snapshot(modelsDir, "models--org--m", "aaa", true);
    await snapshot(modelsDir, "models--org--m", "bbb", false);
    await snapshot(modelsDir, "models--org--d", "ddd", true);

    assert.deepEqual(missingWeights(["vllm", "serve", "org/m", "--revision", "aaa"], modelsDir), []);
    assert.deepEqual(missingWeights(["vllm", "serve", "org/m"], modelsDir), []);
    assert.deepEqual(missingWeights(["vllm", "serve", "org/m", "--revision", "bbb"], modelsDir), ["org/m@bbb"]);
    assert.deepEqual(missingWeights(["vllm", "serve", "org/absent"], modelsDir), ["org/absent"]);
    assert.deepEqual(missingWeights(["vllm", "serve", "/models/models--org--m/snapshots/aaa"], modelsDir), []);
    assert.deepEqual(
      missingWeights(["vllm", "serve", "/models/models--org--m/snapshots/bbb"], modelsDir),
      ["/models/models--org--m/snapshots/bbb"]
    );
    assert.deepEqual(
      missingWeights(["vllm", "serve", "org/m", "--revision", "aaa", "--speculative-config", '{"model":"org/d","revision":"eee"}'], modelsDir),
      ["org/d@eee"]
    );
    // A weight symlink whose blob is gone does not count.
    await fs.rm(path.join(modelsDir, "models--org--m", "blobs", "w-aaa"));
    assert.deepEqual(missingWeights(["vllm", "serve", "org/m", "--revision", "aaa"], modelsDir), ["org/m@aaa"]);
    // A sharded snapshot needs every shard its index names.
    await snapshot(modelsDir, "models--org--s", "sss", true);
    const sharded = path.join(modelsDir, "models--org--s", "snapshots", "sss");
    await fs.writeFile(
      path.join(sharded, "model.safetensors.index.json"),
      JSON.stringify({ weight_map: { a: "model.safetensors", b: "model-00002-of-00002.safetensors" } })
    );
    assert.deepEqual(missingWeights(["vllm", "serve", "org/s", "--revision", "sss"], modelsDir), ["org/s@sss"]);
    await fs.writeFile(path.join(sharded, "model-00002-of-00002.safetensors"), "");
    assert.deepEqual(missingWeights(["vllm", "serve", "org/s", "--revision", "sss"], modelsDir), []);

    // A GGUF repository: no config.json, one folder of split files per variant, served by path.
    const tierPath = "/models/models--org--g/snapshots/ggg/Tier-S";
    const tier = path.join(modelsDir, tierPath.slice("/models/".length));
    const blobs = path.join(modelsDir, "models--org--g", "blobs");
    await fs.mkdir(tier, { recursive: true });
    await fs.mkdir(blobs, { recursive: true });
    const addPart = async (n) => {
      await fs.writeFile(path.join(blobs, `part-${n}`), "");
      await fs.symlink(`../../../blobs/part-${n}`, path.join(tier, `m-0000${n}-of-00003.gguf`));
    };
    const gguf = ["engine", "--model-path", tierPath];
    await addPart(1);
    await addPart(2);
    assert.deepEqual(missingWeights(gguf, modelsDir), [tierPath]);
    await addPart(3);
    assert.deepEqual(missingWeights(gguf, modelsDir), []);
    await fs.symlink("../../../blobs/absent", path.join(tier, "other.gguf"));
    assert.deepEqual(missingWeights(gguf, modelsDir), [tierPath]);
    await fs.rm(path.join(tier, "other.gguf"));
    // Any other /models path the command names must exist: here a pack built beside the weights.
    const withPack = [...gguf, "--pack", `${tierPath}/pack`];
    assert.deepEqual(missingWeights(withPack, modelsDir), [`${tierPath}/pack`]);
    await fs.mkdir(path.join(tier, "pack"));
    assert.deepEqual(missingWeights(withPack, modelsDir), []);
  } finally {
    await fs.rm(modelsDir, { recursive: true, force: true });
  }
});
