import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
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
    assert.equal(touchUnmanaged.body.error.code, "model_not_found");
    assert.equal(touchUnmanaged.body.error.type, "invalid_request_error");

    const missing = await fetch(new URL("/missing", baseUrl));
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "route_not_found");

    const missingStats = await requestJson(baseUrl, "/debug/gpu-stats/sample");
    assert.equal(missingStats.response.status, 404);
    assert.equal(missingStats.body.error.code, "stats_not_found");
  } finally {
    await stopChild(child);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("waker fails closed with 503 when Docker API is unreachable", async () => {
  await fs.mkdir(tmpRoot, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(tmpRoot, "waker-docker-down-test-"));
  const modelsPath = path.join(tempDir, "models.json");
  await fs.writeFile(modelsPath, JSON.stringify(modelsFixture), "utf8");

  const port = await getFreePort();
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

    const ensure = await requestJson(baseUrl, "/ensure/sample", { method: "POST" });
    assert.equal(ensure.response.status, 503);
    assert.equal(ensure.body.error.code, "docker_unavailable");
    assert.equal(ensure.body.error.type, "service_unavailable_error");

    const check = await requestJson(baseUrl, "/check/sample", { method: "POST" });
    assert.equal(check.response.status, 503);
    assert.equal(check.body.error.code, "docker_unavailable");

    // Read-only debug endpoint must degrade gracefully, not fail closed.
    const state = await requestJson(baseUrl, "/debug/state");
    assert.equal(state.response.status, 200);
    assert.deepEqual(state.body.runningExternal, []);
  } finally {
    await stopChild(child);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("waker check surfaces background start failures instead of looping at 202", async () => {
  await fs.mkdir(tmpRoot, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(tmpRoot, "waker-check-failure-test-"));
  const modelsPath = path.join(tempDir, "models.json");
  await fs.writeFile(modelsPath, JSON.stringify(modelsFixture), "utf8");

  let startAttempts = 0;
  const dockerApi = http.createServer((req, res) => {
    if (req.method === "GET" && req.url.startsWith("/containers/json")) {
      const body = JSON.stringify([]);
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }

    if (req.method === "GET" && req.url === "/containers/vllm-sample/json") {
      const body = JSON.stringify({
        State: { Status: "exited", Running: false, StartedAt: "" },
        Config: { Labels: {} }
      });
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }

    if (req.method === "POST" && req.url === "/containers/vllm-sample/start") {
      startAttempts += 1;
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "simulated start failure" }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });
  const dockerPort = await listen(dockerApi);

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ["index.js"], {
    cwd: wakerRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MODELS_CONFIG_PATH: modelsPath,
      DOCKER_HOST: `http://127.0.0.1:${dockerPort}`,
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

    // First check triggers the background start and reports initializing.
    const first = await requestJson(baseUrl, "/check/sample", { method: "POST" });
    assert.equal(first.response.status, 202);

    // Poll until the background failure surfaces.
    const deadline = Date.now() + 10000;
    let last;
    while (Date.now() < deadline) {
      last = await requestJson(baseUrl, "/check/sample", { method: "POST" });
      if (last.response.status !== 202) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    assert.equal(last.response.status, 500, `expected surfaced failure\n${logs.join("")}`);
    assert.equal(last.body.error.code, "internal_error");
    assert.match(last.body.error.message, /failed to start container 'vllm-sample'/i);

    // Repeated checks within the error TTL must not spawn new start attempts.
    const attemptsAfterFailure = startAttempts;
    await requestJson(baseUrl, "/check/sample", { method: "POST" });
    await requestJson(baseUrl, "/check/sample", { method: "POST" });
    assert.equal(startAttempts, attemptsAfterFailure);
  } finally {
    await stopChild(child);
    await new Promise((resolve) => dockerApi.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("waker check busy path returns OpenAI-compatible error envelope", async () => {
  await fs.mkdir(tmpRoot, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(tmpRoot, "waker-check-busy-test-"));
  const modelsPath = path.join(tempDir, "models.json");
  await fs.writeFile(
    modelsPath,
    JSON.stringify({
      sample: {
        container: "vllm-sample",
        port: 8000,
        maxModelLen: 1
      },
      other: {
        container: "vllm-other",
        port: 8000,
        maxModelLen: 1
      }
    }),
    "utf8"
  );

  const startedAt = new Date(Date.now() - 5000).toISOString();
  const dockerApi = http.createServer((req, res) => {
    if (req.method === "GET" && req.url.startsWith("/containers/json")) {
      const body = JSON.stringify([
        {
          State: "running",
          Names: ["/vllm-other"],
          Labels: {}
        }
      ]);
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }

    if (req.method === "GET" && req.url === "/containers/vllm-other/json") {
      const body = JSON.stringify({
        State: {
          Status: "running",
          Running: true,
          StartedAt: startedAt
        },
        Config: { Labels: {} }
      });
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });
  const dockerPort = await listen(dockerApi);

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ["index.js"], {
    cwd: wakerRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MODELS_CONFIG_PATH: modelsPath,
      DOCKER_HOST: `http://127.0.0.1:${dockerPort}`,
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

    const check = await requestJson(baseUrl, "/check/sample", { method: "POST" });
    assert.equal(check.response.status, 429);
    assert.equal(check.response.headers.get("x-dgx-busy-container"), "vllm-other");
    assert.equal(check.body.error.code, "model_busy");
    assert.equal(check.body.error.type, "rate_limit_error");
    assert.equal(check.body.error.param, "model");
  } finally {
    await stopChild(child);
    await new Promise((resolve) => dockerApi.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("waker ensure returns 429 rate-limit envelope when another model is running", async () => {
  await fs.mkdir(tmpRoot, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(tmpRoot, "waker-ensure-busy-test-"));
  const modelsPath = path.join(tempDir, "models.json");
  await fs.writeFile(
    modelsPath,
    JSON.stringify({
      sample: {
        container: "vllm-sample",
        port: 8000,
        maxModelLen: 1
      },
      other: {
        container: "vllm-other",
        port: 8000,
        maxModelLen: 1
      }
    }),
    "utf8"
  );

  const startedAt = new Date(Date.now() - 5000).toISOString();
  const dockerApi = http.createServer((req, res) => {
    if (req.method === "GET" && req.url.startsWith("/containers/json")) {
      const body = JSON.stringify([
        {
          State: "running",
          Names: ["/vllm-other"],
          Labels: {}
        }
      ]);
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }

    if (req.method === "GET" && req.url === "/containers/vllm-other/json") {
      const body = JSON.stringify({
        State: { Status: "running", Running: true, StartedAt: startedAt },
        Config: { Labels: {} }
      });
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });
  const dockerPort = await listen(dockerApi);

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ["index.js"], {
    cwd: wakerRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MODELS_CONFIG_PATH: modelsPath,
      DOCKER_HOST: `http://127.0.0.1:${dockerPort}`,
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

    const ensure = await requestJson(baseUrl, "/ensure/sample", { method: "POST" });
    assert.equal(ensure.response.status, 429);
    assert.equal(ensure.body.error.type, "rate_limit_error");
    assert.equal(ensure.body.error.code, "model_busy");
    assert.equal(ensure.body.error.param, "model");
    assert.match(ensure.body.error.message, /'other' is already running/);
    assert.ok(Number(ensure.response.headers.get("retry-after")) >= 1);
    assert.equal(ensure.response.headers.get("x-dgx-busy-container"), "vllm-other");
    assert.equal(ensure.response.headers.get("x-dgx-busy-model"), "other");
  } finally {
    await stopChild(child);
    await new Promise((resolve) => dockerApi.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("waker blocks normal model ensure when labelled external GPU workload is running", async () => {
  await fs.mkdir(tmpRoot, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(tmpRoot, "waker-external-test-"));
  const modelsPath = path.join(tempDir, "models.json");
  await fs.writeFile(modelsPath, JSON.stringify(modelsFixture), "utf8");

  const externalContainers = [
    {
      State: "running",
      Names: ["/comfyui"],
      Labels: {
        "dgx.spark.gpu-workload": "true",
        "dgx.spark.workload.name": "comfyui",
        "dgx.spark.workload.kind": "comfyui",
        "dgx.spark.scheduler.policy": "external-exclusive"
      }
    }
  ];

  const dockerApi = http.createServer((req, res) => {
    if (req.method === "GET" && req.url.startsWith("/containers/json")) {
      const body = JSON.stringify(externalContainers);
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });
  const dockerPort = await listen(dockerApi);

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ["index.js"], {
    cwd: wakerRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MODELS_CONFIG_PATH: modelsPath,
      DOCKER_HOST: `http://127.0.0.1:${dockerPort}`,
      EXTERNAL_GPU_POLICY: "block",
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

    const state = await requestJson(baseUrl, "/debug/state");
    assert.equal(state.response.status, 200);
    assert.equal(state.body.externalGpuPolicy, "block");
    assert.equal(state.body.runningExternal[0].container, "comfyui");

    const ensure = await requestJson(baseUrl, "/ensure/sample", { method: "POST" });
    assert.equal(ensure.response.status, 429);
    assert.equal(ensure.response.headers.get("x-dgx-busy-workload"), "comfyui");
    assert.equal(ensure.body.error.code, "external_gpu_busy");
    assert.equal(ensure.body.error.type, "rate_limit_error");
  } finally {
    await stopChild(child);
    await new Promise((resolve) => dockerApi.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("waker observe mode does not block a normal model when external GPU workload is running", async () => {
  await fs.mkdir(tmpRoot, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(tmpRoot, "waker-external-observe-test-"));
  const modelsPath = path.join(tempDir, "models.json");
  const healthServer = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });
  const healthPort = await listen(healthServer);

  await fs.writeFile(
    modelsPath,
    JSON.stringify({
      sample: {
        container: "127.0.0.1",
        port: healthPort,
        maxModelLen: 1
      }
    }),
    "utf8"
  );

  const externalContainers = [
    {
      State: "running",
      Names: ["/comfyui"],
      Labels: {
        "dgx.spark.gpu-workload": "true",
        "dgx.spark.workload.name": "comfyui",
        "dgx.spark.workload.kind": "comfyui",
        "dgx.spark.scheduler.policy": "external-exclusive"
      }
    }
  ];

  const dockerApi = http.createServer((req, res) => {
    if (req.method === "GET" && req.url.startsWith("/containers/json")) {
      const body = JSON.stringify(externalContainers);
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }

    if (req.method === "GET" && req.url === "/containers/127.0.0.1/json") {
      const body = JSON.stringify({
        State: {
          Status: "running",
          Running: true,
          StartedAt: new Date().toISOString()
        },
        Config: { Labels: {} }
      });
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });
  const dockerPort = await listen(dockerApi);

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ["index.js"], {
    cwd: wakerRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MODELS_CONFIG_PATH: modelsPath,
      DOCKER_HOST: `http://127.0.0.1:${dockerPort}`,
      EXTERNAL_GPU_POLICY: "observe",
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

    const ensure = await requestJson(baseUrl, "/ensure/sample", { method: "POST" });
    assert.equal(ensure.response.status, 200);
    assert.equal(ensure.body.ok, true);
    assert.equal(ensure.response.headers.get("x-dgx-busy-workload"), null);
  } finally {
    await stopChild(child);
    await new Promise((resolve) => dockerApi.close(resolve));
    await new Promise((resolve) => healthServer.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("waker block mode respects observe-only external workload policy", async () => {
  await fs.mkdir(tmpRoot, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(tmpRoot, "waker-external-policy-test-"));
  const modelsPath = path.join(tempDir, "models.json");
  const healthServer = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });
  const healthPort = await listen(healthServer);

  await fs.writeFile(
    modelsPath,
    JSON.stringify({
      sample: {
        container: "127.0.0.1",
        port: healthPort,
        maxModelLen: 1
      }
    }),
    "utf8"
  );

  const externalContainers = [
    {
      State: "running",
      Names: ["/comfyui"],
      Labels: {
        "dgx.spark.gpu-workload": "true",
        "dgx.spark.workload.name": "comfyui",
        "dgx.spark.workload.kind": "comfyui",
        "dgx.spark.scheduler.policy": "observe"
      }
    }
  ];

  const dockerApi = http.createServer((req, res) => {
    if (req.method === "GET" && req.url.startsWith("/containers/json")) {
      const body = JSON.stringify(externalContainers);
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }

    if (req.method === "GET" && req.url === "/containers/127.0.0.1/json") {
      const body = JSON.stringify({
        State: {
          Status: "running",
          Running: true,
          StartedAt: new Date().toISOString()
        },
        Config: { Labels: {} }
      });
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });
  const dockerPort = await listen(dockerApi);

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ["index.js"], {
    cwd: wakerRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MODELS_CONFIG_PATH: modelsPath,
      DOCKER_HOST: `http://127.0.0.1:${dockerPort}`,
      EXTERNAL_GPU_POLICY: "block",
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

    const state = await requestJson(baseUrl, "/debug/state");
    assert.equal(state.response.status, 200);
    assert.equal(state.body.runningExternal[0].policy, "observe");

    const ensure = await requestJson(baseUrl, "/ensure/sample", { method: "POST" });
    assert.equal(ensure.response.status, 200);
    assert.equal(ensure.body.ok, true);
    assert.equal(ensure.response.headers.get("x-dgx-busy-workload"), null);
  } finally {
    await stopChild(child);
    await new Promise((resolve) => dockerApi.close(resolve));
    await new Promise((resolve) => healthServer.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("waker block mode does not reject utility model ensure when external GPU workload is running", async () => {
  await fs.mkdir(tmpRoot, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(tmpRoot, "waker-external-utility-test-"));
  const modelsPath = path.join(tempDir, "models.json");
  const healthServer = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });
  const healthPort = await listen(healthServer);

  await fs.writeFile(
    modelsPath,
    JSON.stringify({
      utility: {
        container: "127.0.0.1",
        port: healthPort,
        maxModelLen: 1,
        lifecycle: "utility"
      }
    }),
    "utf8"
  );

  const externalContainers = [
    {
      State: "running",
      Names: ["/comfyui"],
      Labels: {
        "dgx.spark.gpu-workload": "true",
        "dgx.spark.workload.name": "comfyui",
        "dgx.spark.workload.kind": "comfyui",
        "dgx.spark.scheduler.policy": "external-exclusive"
      }
    }
  ];

  const dockerApi = http.createServer((req, res) => {
    if (req.method === "GET" && req.url.startsWith("/containers/json")) {
      const body = JSON.stringify(externalContainers);
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }

    if (req.method === "GET" && req.url === "/containers/127.0.0.1/json") {
      const body = JSON.stringify({
        State: {
          Status: "running",
          Running: true,
          StartedAt: new Date().toISOString()
        },
        Config: { Labels: {} }
      });
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });
  const dockerPort = await listen(dockerApi);

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ["index.js"], {
    cwd: wakerRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MODELS_CONFIG_PATH: modelsPath,
      DOCKER_HOST: `http://127.0.0.1:${dockerPort}`,
      EXTERNAL_GPU_POLICY: "block",
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

    const ensure = await requestJson(baseUrl, "/ensure/utility", { method: "POST" });
    assert.equal(ensure.response.status, 200);
    assert.equal(ensure.body.ok, true);
    assert.equal(ensure.response.headers.get("x-dgx-busy-workload"), null);
  } finally {
    await stopChild(child);
    await new Promise((resolve) => dockerApi.close(resolve));
    await new Promise((resolve) => healthServer.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
