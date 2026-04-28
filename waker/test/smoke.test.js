import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const wakerRoot = process.cwd();
const repoRoot = path.resolve(wakerRoot, "..");
const tmpRoot = path.join(repoRoot, "tmp");
const modelsFixture = {
  sample: {
    container: "vllm-sample",
    port: 8000,
    maxModelLen: 1
  }
};

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(new URL(pathname, baseUrl), options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body };
}

async function waitForServer(baseUrl, child, logs) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`waker exited early with code ${child.exitCode}\n${logs.join("")}`);
    }

    try {
      const response = await fetch(new URL("/healthz", baseUrl));
      if (response.status === 200) {
        return;
      }
    } catch {
      // keep polling until ready or deadline expires
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`waker did not become healthy in time\n${logs.join("")}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

test("waker serves basic smoke routes without Docker side effects", async () => {
  await fs.mkdir(tmpRoot, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(tmpRoot, "waker-test-"));
  const modelsPath = path.join(tempDir, "models.json");
  await fs.writeFile(modelsPath, JSON.stringify(modelsFixture), "utf8");

  const port = 18181;
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ["index.js"], {
    cwd: wakerRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MODELS_CONFIG_PATH: modelsPath,
      DOCKER_HOST: "unix:///tmp/nonexistent-docker.sock",
      TICK_MS: "60000",
      MONITOR_INTERVAL_MS: "60000",
      VERBOSE: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => logs.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString("utf8")));

  try {
    await waitForServer(baseUrl, child, logs);

    const health = await fetch(new URL("/healthz", baseUrl));
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok");

    const touchManaged = await requestJson(baseUrl, "/touch/vllm-sample", { method: "POST" });
    assert.equal(touchManaged.response.status, 200);
    assert.equal(touchManaged.body.ok, true);
    assert.equal(touchManaged.body.name, "vllm-sample");

    const touchUnmanaged = await requestJson(baseUrl, "/touch/not-managed", { method: "POST" });
    assert.equal(touchUnmanaged.response.status, 400);
    assert.equal(touchUnmanaged.body.ok, false);
    assert.equal(touchUnmanaged.body.error, "not managed");

    const missing = await fetch(new URL("/missing", baseUrl));
    assert.equal(missing.status, 404);
  } finally {
    await stopChild(child);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
