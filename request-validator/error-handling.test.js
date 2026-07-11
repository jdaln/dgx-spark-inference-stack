import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getFreePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function waitForServer(baseUrl, child, logs) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`validator exited early with code ${child.exitCode}\n${logs.join("")}`);
    }

    try {
      const response = await fetch(new URL("/healthz", baseUrl));
      if (response.status === 200) return;
    } catch {
      // keep polling
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`validator did not become healthy\n${logs.join("")}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function writeJson(res, statusCode, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
    ...headers
  });
  res.end(text);
}

test("validator returns OpenAI-compatible errors on gateway failure paths", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "validator-errors-"));
  const upstreamPort = await getFreePort();
  const modelsPath = path.join(tempDir, "models.json");
  await fs.writeFile(
    modelsPath,
    JSON.stringify({
      sample: {
        container: "127.0.0.1",
        port: upstreamPort,
        maxModelLen: 4096
      }
    }),
    "utf8"
  );

  let wakerMode = "ok";
  const waker = http.createServer((req, res) => {
    if (wakerMode === "openai-error") {
      return writeJson(
        res,
        429,
        {
          error: {
            message: "GPU is busy with external workload 'comfyui'.",
            type: "rate_limit_error",
            param: "model",
            code: "external_gpu_busy"
          }
        },
        {
          "Retry-After": "30",
          "X-DGX-Busy-Workload": "comfyui",
          "X-DGX-External-GPU-Policy": "block"
        }
      );
    }

    if (wakerMode === "invalid-json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{not json");
      return;
    }

    writeJson(res, 200, { ok: true, name: "127.0.0.1", healthUrl: "http://127.0.0.1/health" });
  });
  const wakerPort = await listen(waker);

  const validatorPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${validatorPort}`;
  const logs = [];
  const child = spawn(process.execPath, ["index.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(validatorPort),
      WAKER_URL: `http://127.0.0.1:${wakerPort}`,
      MODELS_CONFIG_PATH: modelsPath,
      VERBOSE: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => logs.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString("utf8")));

  async function post(payload) {
    const response = await fetch(new URL("/v1/chat/completions", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload
    });
    return { response, body: await response.json() };
  }

  try {
    await waitForServer(baseUrl, child, logs);

    const invalid = await post("{bad json");
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.error.code, "invalid_json");

    const missing = await post('{"messages":[{"role":"user","content":"hi"}]}');
    assert.equal(missing.response.status, 400);
    assert.equal(missing.body.error.code, "missing_model");

    const unknown = await post('{"model":"missing","messages":[{"role":"user","content":"hi"}]}');
    assert.equal(unknown.response.status, 404);
    assert.equal(unknown.body.error.code, "model_not_found");

    wakerMode = "openai-error";
    const externalBusy = await post('{"model":"sample","messages":[{"role":"user","content":"hi"}]}');
    assert.equal(externalBusy.response.status, 429);
    assert.equal(externalBusy.response.headers.get("x-dgx-busy-workload"), "comfyui");
    assert.equal(externalBusy.response.headers.get("x-dgx-external-gpu-policy"), "block");
    assert.equal(externalBusy.body.error.code, "external_gpu_busy");

    wakerMode = "invalid-json";
    const invalidWaker = await post('{"model":"sample","messages":[{"role":"user","content":"hi"}]}');
    assert.equal(invalidWaker.response.status, 502);
    assert.equal(invalidWaker.body.error.code, "waker_invalid_response");

    wakerMode = "ok";
    const upstreamUnavailable = await post('{"model":"sample","messages":[{"role":"user","content":"hi"}]}');
    assert.equal(upstreamUnavailable.response.status, 502);
    assert.equal(upstreamUnavailable.body.error.code, "upstream_unavailable");
  } finally {
    await stopChild(child);
    await new Promise((resolve) => waker.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("validator rejects oversized request bodies with a 413 envelope", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "validator-bodycap-"));
  const modelsPath = path.join(tempDir, "models.json");
  await fs.writeFile(
    modelsPath,
    JSON.stringify({
      sample: {
        container: "127.0.0.1",
        port: 9,
        maxModelLen: 4096
      }
    }),
    "utf8"
  );

  const validatorPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${validatorPort}`;
  const logs = [];
  const child = spawn(process.execPath, ["index.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(validatorPort),
      WAKER_URL: "http://127.0.0.1:9",
      MODELS_CONFIG_PATH: modelsPath,
      MAX_BODY_BYTES: "1024",
      VERBOSE: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => logs.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString("utf8")));

  try {
    await waitForServer(baseUrl, child, logs);

    const bigBody = JSON.stringify({ model: "sample", messages: [{ role: "user", content: "x".repeat(4096) }] });
    const response = await fetch(new URL("/v1/chat/completions", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: bigBody,
      signal: AbortSignal.timeout(5000)
    });
    assert.equal(response.status, 413);
    const parsed = await response.json();
    assert.equal(parsed.error.code, "request_too_large");
    assert.equal(parsed.error.type, "invalid_request_error");
    assert.equal(child.exitCode, null, `validator crashed:\n${logs.join("")}`);
  } finally {
    await stopChild(child);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("validator survives upstream dying mid-stream", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "validator-stream-"));

  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: chunk1\n\n");
    setTimeout(() => res.socket.destroy(), 50);
  });
  const upstreamPort = await listen(upstream);

  const modelsPath = path.join(tempDir, "models.json");
  await fs.writeFile(
    modelsPath,
    JSON.stringify({
      sample: {
        container: "127.0.0.1",
        port: upstreamPort,
        maxModelLen: 4096
      }
    }),
    "utf8"
  );

  const waker = http.createServer((req, res) => {
    writeJson(res, 200, { ok: true, name: "127.0.0.1", healthUrl: "http://127.0.0.1/health" });
  });
  const wakerPort = await listen(waker);

  const validatorPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${validatorPort}`;
  const logs = [];
  const child = spawn(process.execPath, ["index.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(validatorPort),
      WAKER_URL: `http://127.0.0.1:${wakerPort}`,
      MODELS_CONFIG_PATH: modelsPath,
      VERBOSE: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => logs.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString("utf8")));

  try {
    await waitForServer(baseUrl, child, logs);

    let timedOut = false;
    try {
      const response = await fetch(new URL("/v1/chat/completions", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"model":"sample","messages":[{"role":"user","content":"hi"}],"stream":true}',
        signal: AbortSignal.timeout(5000)
      });
      await response.text();
    } catch (e) {
      // A truncated stream is expected; hanging until the abort timeout is not.
      timedOut = /timeout/i.test(String(e.name || "")) || /timeout/i.test(String(e.cause?.name || ""));
    }

    assert.equal(timedOut, false, "response must terminate promptly when upstream dies");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(child.exitCode, null, `validator crashed:\n${logs.join("")}`);
    const health = await fetch(new URL("/healthz", baseUrl));
    assert.equal(health.status, 200);
  } finally {
    await stopChild(child);
    await new Promise((resolve) => waker.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
