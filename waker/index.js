// index.js — docker-waker (ESM, single-tenant mode)

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { startMonitoring, getModelStats, getAllStats } from "./gpu-monitor.js";

// -------- config --------
const PORT = Number(process.env.PORT || 18080);
const MANAGE_PREFIX = process.env.MANAGE_PREFIX || "vllm-";
const IGNORE = new Set(
  (process.env.IGNORE_NAMES || "vllm-gateway,vllm-waker,vllm-request-validator")
    .split(",").map(s => s.trim()).filter(Boolean)
);
const IDLE_STOP_SECONDS = Number(process.env.IDLE_STOP_SECONDS || 0); // 0=disabled
const NO_STOP_BEFORE_SECONDS = Number(process.env.NO_STOP_BEFORE_SECONDS || 30);
const HEALTH_TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS || 900_000);
const DOCKER_STOP_TIMEOUT_SECONDS = Number(process.env.DOCKER_STOP_TIMEOUT_SECONDS || 5);
const TICK_MS = Number(process.env.TICK_MS || 1000);
const STOP_DEBOUNCE_MS = Number(process.env.STOP_DEBOUNCE_MS || 20_000);
const BUSY_STATUS_CODE = Number(process.env.BUSY_STATUS_CODE || 409); // 409 = Conflict
const UTILITY_CONTAINER = process.env.UTILITY_CONTAINER || process.env.GEMMA_CONTAINER || "vllm-qwen2.5-1.5b";
const EXCLUSIVE_CONTAINERS = new Set(
  (process.env.EXCLUSIVE_CONTAINERS || process.env.EXCLUSIVE_CONTAINER || "vllm-oss120b")
    .split(",").map(s => s.trim()).filter(Boolean)
);

const MODEL_HEALTH_URL_TEMPLATE = process.env.MODEL_HEALTH_URL_TEMPLATE || "http://{name}:8001/health";

const DOCKER_HOST = process.env.DOCKER_HOST || "unix:///var/run/docker.sock";
const DOCKER_API_VERSION = process.env.DOCKER_API_VERSION || "v1.43";

const VERBOSE = (process.env.VERBOSE || "1") !== "0";

// Parse MODELS_JSON for model name -> container name mapping
let MODELS_MAP = {};
try {
  const modelsJson = process.env.MODELS_JSON || "{}";
  const models = JSON.parse(modelsJson);
  for (const [key, config] of Object.entries(models)) {
    if (config.container) {
      MODELS_MAP[key] = config.container;
    }
  }
  log("[waker] Models mapping:", MODELS_MAP);
} catch (e) {
  warn("[waker] Failed to parse MODELS_JSON:", e.message);
}

// -------- tiny utils --------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const now = () => Date.now();
const fmtS = (ms) => `${Math.floor(ms / 1000)}s`;
const isManaged = (n) => n.startsWith(MANAGE_PREFIX) && !IGNORE.has(n);
function log(...a) { if (VERBOSE) console.log(...a); }
function warn(...a) { console.warn(...a); }
function err(...a) { console.error(...a); }

// -------- Docker Engine API (socket HTTP) --------
function dockerRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json" };
    let data = null;
    if (body !== undefined && body !== null) {
      data = JSON.stringify(body);
      headers["Content-Length"] = Buffer.byteLength(data);
    }

    let reqOpts;
    if (DOCKER_HOST.startsWith("unix://") || DOCKER_HOST.startsWith("/")) {
      const socketPath = DOCKER_HOST.startsWith("unix://") ? DOCKER_HOST.slice(7) : DOCKER_HOST;
      reqOpts = { socketPath, path, method, headers };
    } else {
      const u = new URL(DOCKER_HOST);
      reqOpts = { protocol: u.protocol, hostname: u.hostname, port: u.port || 2375, path, method, headers };
    }

    const rq = http.request(reqOpts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString("utf8");
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        if (res.statusCode === 204) return resolve(null);
        if (!ok) return reject(new Error(`Docker ${method} ${path} -> ${res.statusCode} ${res.statusMessage} ${text}`));
        try { resolve(text ? JSON.parse(text) : null); }
        catch { resolve(text); }
      });
    });
    rq.on("error", reject);
    if (data) rq.write(data);
    rq.end();
  });
}
const d = (p) => `/${DOCKER_API_VERSION}${p}`;
const listContainers = (all = true) => dockerRequest("GET", d(`/containers/json?all=${all ? 1 : 0}`));
const inspectContainer = (name) => dockerRequest("GET", d(`/containers/${encodeURIComponent(name)}/json`));
const startContainer = (name) => dockerRequest("POST", d(`/containers/${encodeURIComponent(name)}/start`));
const stopContainer = (name, t) => dockerRequest("POST", d(`/containers/${encodeURIComponent(name)}/stop?t=${t}`));

// -------- health wait (pure http/https) --------
function httpOk(url, graceMs = 10_000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), graceMs);
    const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + (u.search || ""), method: "GET", signal: ac.signal }, (res) => {
      clearTimeout(to);
      res.resume(); // drain
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on("error", () => { clearTimeout(to); resolve(false); });
    req.end();
  });
}

async function waitHttpOk(url, deadlineMs) {
  let attempts = 0;
  while (now() < deadlineMs) {
    attempts++;
    const ok = await httpOk(url, 5_000);
    if (ok) return true;
    await sleep(1_000);
  }
  throw new Error(`health timeout after ${attempts} attempts for ${url}`);
}

// -------- state --------
const startAtMs = new Map();
const lastSeenMs = new Map();
const lastStopMs = new Map();

// -------- busy helper --------
class BusyError extends Error {
  constructor(info) { super("busy"); this.name = "BusyError"; this.info = info; }
}

async function getRunningManagedExcept(exceptName) {
  let cs = [];
  try { cs = await listContainers(true); } catch (e) { err("[waker] docker list error:", e.message || e); }
  const names = new Set();
  for (const c of cs) {
    if (c.State !== "running") continue;
    for (const raw of c.Names || []) {
      const n = raw.replace(/^\//, "");
      if (!isManaged(n)) continue;
      if (n === exceptName) continue;
      names.add(n);
    }
  }
  return [...names];
}

async function getContainerSummary(name) {
  try {
    const insp = await inspectContainer(name);
    const startedAt = Date.parse(insp?.State?.StartedAt || "") || 0;
    const lastSeen = lastSeenMs.get(name) || startedAt;
    const uptimeMs = startedAt ? (now() - startedAt) : 0;
    const idleMs = startedAt ? (now() - lastSeen) : 0;

    // Calculate when model might be released (if idle timeout is enabled)
    let timeUntilReleaseSec = null;
    let willAutoStop = false;
    if (IDLE_STOP_SECONDS > 0 && startedAt) {
      const idleTimeoutMs = IDLE_STOP_SECONDS * 1000;
      const minUptimeMs = NO_STOP_BEFORE_SECONDS * 1000;
      const remainingIdleMs = Math.max(0, idleTimeoutMs - idleMs);
      const remainingMinUptimeMs = Math.max(0, minUptimeMs - uptimeMs);
      const remainingMs = Math.max(remainingIdleMs, remainingMinUptimeMs);
      timeUntilReleaseSec = Math.ceil(remainingMs / 1000);
      willAutoStop = uptimeMs >= minUptimeMs; // only auto-stops after minimum uptime
    }

    return {
      name,
      startedAt,
      startedAtISO: startedAt ? new Date(startedAt).toISOString() : null,
      uptimeSec: startedAt ? Math.round(uptimeMs / 1000) : null,
      idleSec: startedAt ? Math.round(idleMs / 1000) : null,
      lastSeenISO: lastSeen ? new Date(lastSeen).toISOString() : null,
      timeUntilReleaseSec,
      willAutoStop,
      healthUrl: MODEL_HEALTH_URL_TEMPLATE.replace("{name}", name),
      state: insp?.State?.Status || insp?.State?.State || "unknown"
    };
  } catch {
    return { name, state: "unknown" };
  }
}

// -------- ensure (start + wait) --------
async function ensureModel(modelKey) {
  const name = MODELS_MAP[modelKey] ||
    (modelKey.startsWith(MANAGE_PREFIX) ? modelKey : `${MANAGE_PREFIX}${modelKey}`);
  log(`[waker] ensure request for model key: ${modelKey} -> container: ${name}`);

  // Set starting state immediately to prevent tick() race
  starting.set(name, true);

  try {
    // single-tenant guard
    if (isManaged(name)) {
      const others = await getRunningManagedExcept(name);
      if (others.length > 0) {
        const current = await getContainerSummary(others[0]);
        const retryAfterSec = Math.max(1, Math.ceil(HEALTH_TIMEOUT_MS / 1000));
        log(`[waker] BUSY: ${current.name} is running; refusing to start ${name}.`);
        throw new BusyError({
          busy: true,
          currentModel: current,
          running: await Promise.all(others.map(getContainerSummary)),
          retryAfterSec
        });
      }
    }

    // Mutual Exclusivity: stop the utility model if an exclusive model needs to start
    if (EXCLUSIVE_CONTAINERS.has(name)) {
      try {
        const utilInsp = await inspectContainer(UTILITY_CONTAINER);
        if (utilInsp?.State?.Running) {
          log(`[waker] stopping ${UTILITY_CONTAINER} to make room for ${name}`);
          await stopContainer(UTILITY_CONTAINER, DOCKER_STOP_TIMEOUT_SECONDS);
          log(`[waker] waiting 15s for GPU memory reclamation...`);
          await sleep(15000);
        }
      } catch (e) { /* ignore if not found */ }
    }

    let insp;
    try {
      insp = await inspectContainer(name);
    } catch (e) {
      throw new Error(`container ${name} not found (${e.message})`);
    }

    const running = !!insp?.State?.Running;
    if (!running) {
      log(`[waker] starting ${name}...`);
      await startContainer(name);
      await sleep(300);
      insp = await inspectContainer(name);
    }

    const started = Date.parse(insp?.State?.StartedAt || "") || now();
    startAtMs.set(name, started);
    lastSeenMs.set(name, started);

    const url = MODEL_HEALTH_URL_TEMPLATE.replace("{name}", name);
    log(`[waker] waiting health ${url} up to ${fmtS(HEALTH_TIMEOUT_MS)}`);
    await waitHttpOk(url, now() + HEALTH_TIMEOUT_MS);

    lastSeenMs.set(name, now());
    log(`[waker] ${name} is healthy`);
    return { name, healthUrl: url };
  } finally {
    starting.delete(name);
  }
}

// -------- check (non-blocking status) --------
// A map to keep track of models that are currently in the process of starting up.
const starting = new Map();

async function checkModel(modelKey) {
  const name = MODELS_MAP[modelKey] || (modelKey.startsWith(MANAGE_PREFIX) ? modelKey : `${MANAGE_PREFIX}${modelKey}`);
  log(`[waker] check request for model key: ${modelKey} -> container: ${name}`);

  // 1. Single-tenant guard: check if another model is running.
  const others = await getRunningManagedExcept(name);
  if (others.length > 0) {
    const current = await getContainerSummary(others[0]);
    log(`[waker] BUSY on check: ${current.name} is running.`);
    return { status: "busy", ...current };
  }

  // 2. Check the container's current state.
  let insp;
  try {
    insp = await inspectContainer(name);
  } catch (e) {
    // If the container doesn't exist, it's an error.
    return { status: "error", message: `Container ${name} not found`, statusCode: 404 };
  }

  // 3. If it's already running, check its health.
  if (insp?.State?.Running) {
    const healthUrl = MODEL_HEALTH_URL_TEMPLATE.replace("{name}", name);
    const isHealthy = await httpOk(healthUrl, 2000); // Quick 2s timeout for check.
    if (isHealthy) {
      log(`[waker] READY on check: ${name} is running and healthy.`);
      lastSeenMs.set(name, now()); // Touch the model to keep it alive.
      return { status: "ready", name };
    } else {
      log(`[waker] INITIALIZING on check: ${name} is running but not healthy yet.`);
      return { status: "initializing", name, message: "Container is running but not yet healthy" };
    }
  }

  // 4. If it's stopped, trigger a start but don't wait.
  // Avoid re-triggering if a start is already in progress.
  if (!starting.has(name)) {
    log(`[waker] STARTING on check: ${name} was stopped, initiating start.`);
    starting.set(name, true);
    // This is "fire and forget" - we start the process and immediately return.
    ensureModel(modelKey)
      .then(() => log(`[waker] background ensure for ${name} completed.`))
      .catch((e) => warn(`[waker] background ensure for ${name} failed:`, e.message))
      .finally(() => starting.delete(name));
  } else {
    log(`[waker] INITIALIZING on check: ${name} is already in the process of starting.`);
  }

  return { status: "initializing", name, message: "Container is starting" };
}

// -------- idle/stop loop --------
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    let cs = [];
    try { cs = await listContainers(true); }
    catch (e) { err("[waker] docker list error:", e.message || e); return; }

    const managed = new Set();
    for (const c of cs) {
      for (const raw of c.Names || []) {
        const n = raw.replace(/^\//, "");
        if (isManaged(n)) managed.add(n);
      }
    }

    for (const name of managed) {
      let insp;
      try { insp = await inspectContainer(name); }
      catch { continue; }
      if (!insp?.State?.Running) continue;

      const started = Date.parse(insp.State.StartedAt || "") || now();
      const prev = startAtMs.get(name);
      if (!prev || prev !== started) {
        startAtMs.set(name, started);
        lastSeenMs.set(name, started);
        continue; // grace on fresh start
      }

      if (IDLE_STOP_SECONDS <= 0) continue;

      const idleMs = IDLE_STOP_SECONDS * 1000;
      const graceMs = NO_STOP_BEFORE_SECONDS * 1000;
      const uptime = now() - started;
      const lastSeen = lastSeenMs.get(name) ?? started;
      const idleFor = now() - lastSeen;
      const eligible = uptime >= idleMs && uptime >= graceMs && idleFor >= idleMs;

      const lastStop = lastStopMs.get(name) || 0;
      const debounced = now() - lastStop < STOP_DEBOUNCE_MS;

      if (eligible && !debounced) {
        console.log(`[waker] stopping ${name} (idle ${fmtS(idleFor)} | uptime ${fmtS(uptime)})`);
        stopContainer(name, DOCKER_STOP_TIMEOUT_SECONDS).catch((e) => warn(`[waker] stop error ${name}:`, e.message || e));
        lastStopMs.set(name, now());
      }
    }

    // Auto-restart Utility model if no Exclusive containers are running or starting
    if (UTILITY_CONTAINER && EXCLUSIVE_CONTAINERS.size > 0) {
      let exclusiveActive = false;
      for (const name of EXCLUSIVE_CONTAINERS) {
        if (starting.has(name)) {
          exclusiveActive = true;
          break;
        }
        try {
          const insp = await inspectContainer(name);
          if (insp?.State?.Running) {
            exclusiveActive = true;
            break;
          }
        } catch { }
      }

      if (!exclusiveActive) {
        let utilRunning = false;
        try {
          const insp = await inspectContainer(UTILITY_CONTAINER);
          utilRunning = !!insp?.State?.Running;
        } catch { }

        if (!utilRunning) {
          log(`[waker] auto-starting ${UTILITY_CONTAINER} (no exclusive models are active)`);
          startContainer(UTILITY_CONTAINER).catch(e => warn(`[waker] failed to auto-start ${UTILITY_CONTAINER}:`, e.message));
        }
      }
    }
  } finally {
    ticking = false;
  }
}

// -------- http helpers --------
function json(res, code, obj, extraHeaders) {
  const s = JSON.stringify(obj);
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.setHeader("content-length", Buffer.byteLength(s));
  res.end(s);
}

function notFound(res, msg = "not found") {
  res.statusCode = 404;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(msg);
}

// -------- server --------
const server = http.createServer(async (req, res) => {
  const startT = now();
  const { method, url: rawUrl } = req;
  try {
    const u = new URL(rawUrl, `http://${req.headers.host || "localhost"}`);
    log(`[waker] ${method} ${u.pathname}${u.search || ""}`);

    if (u.pathname === "/healthz") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("ok");
      return;
    }

    if (method === "GET" && u.pathname === "/debug/state") {
      // expose who's currently running (if any) for visibility
      const running = await getRunningManagedExcept("__none__");
      const current = running.length ? await getContainerSummary(running[0]) : null;
      return json(res, 200, {
        config: {
          PORT, MANAGE_PREFIX, IGNORE: [...IGNORE],
          IDLE_STOP_SECONDS, NO_STOP_BEFORE_SECONDS,
          HEALTH_TIMEOUT_MS, DOCKER_STOP_TIMEOUT_SECONDS,
          TICK_MS, STOP_DEBOUNCE_MS,
          DOCKER_HOST, DOCKER_API_VERSION
        },
        startAtMs: Object.fromEntries(startAtMs),
        lastSeenMs: Object.fromEntries(lastSeenMs),
        lastStopMs: Object.fromEntries(lastStopMs),
        busyWith: current,
        now: now()
      });
    }

    if (method === "GET" && u.pathname === "/debug/gpu-stats") {
      const stats = await getAllStats();
      return json(res, 200, { stats });
    }

    if (method === "GET" && u.pathname.startsWith("/debug/gpu-stats/")) {
      const model = decodeURIComponent(u.pathname.split("/").pop());
      const stats = await getModelStats(model);
      if (!stats) return json(res, 404, { error: "no stats found" });
      return json(res, 200, { model, stats });
    }

    if (method === "POST" && u.pathname.startsWith("/touch/")) {
      const name = decodeURIComponent(u.pathname.split("/").pop());
      if (!isManaged(name)) return json(res, 400, { ok: false, error: "not managed" });
      lastSeenMs.set(name, now());
      return json(res, 200, { ok: true, name, lastSeen: lastSeenMs.get(name) });
    }

    if (method === "POST" && (u.pathname === "/ensure" || u.pathname.startsWith("/ensure/"))) {
      const short =
        u.searchParams.get("model") ||
        (u.pathname.includes("/ensure/") ? decodeURIComponent(u.pathname.split("/").pop()) : null);
      if (!short) return json(res, 400, { ok: false, error: "missing model" });
      try {
        const out = await ensureModel(short);
        return json(res, 200, { ok: true, ...out });
      } catch (e) {
        if (e instanceof BusyError) {
          const retryAfterSec = e.info?.retryAfterSec ?? Math.max(1, Math.ceil(HEALTH_TIMEOUT_MS / 1000));
          const current = e.info?.currentModel || {};

          // Add detailed headers for nginx to capture
          const headers = {
            "Retry-After": String(retryAfterSec),
            "X-Busy-Model": current.name || "unknown",
            "X-Model-Uptime-Sec": String(current.uptimeSec || 0),
            "X-Model-Idle-Sec": String(current.idleSec || 0),
            "X-Time-Until-Release-Sec": String(current.timeUntilReleaseSec || retryAfterSec),
            "X-Model-Will-Auto-Stop": String(current.willAutoStop || false)
          };

          return json(
            res,
            BUSY_STATUS_CODE,
            { ok: false, error: "busy", ...e.info },
            headers
          );
        }
        return json(res, 500, { ok: false, error: e.message || String(e) });
      }
    }

    if (method === "POST" && u.pathname.startsWith("/check/")) {
      const modelKey = decodeURIComponent(u.pathname.split("/").pop());
      if (!modelKey) return json(res, 400, { ok: false, error: "missing model key" });

      const result = await checkModel(modelKey);

      if (result.status === "ready") {
        return json(res, 200, { status: "ready", model: result.name });
      }
      if (result.status === "busy") {
        const retryAfterSec = result.timeUntilReleaseSec || Math.max(1, Math.ceil(HEALTH_TIMEOUT_MS / 1000));
        const headers = { "Retry-After": String(retryAfterSec) };
        return json(res, 429, { status: "busy", requested: modelKey, current: result }, headers);
      }
      if (result.status === "initializing") {
        return json(res, 202, { status: "initializing", model: result.name, message: result.message });
      }
      // Handle error status from checkModel
      return json(res, result.statusCode || 500, { status: "error", message: result.message });
    }

    return notFound(res);
  } catch (e) {
    err("[waker] handler error:", e?.message || e);
    try { return json(res, 500, { ok: false, error: e?.message || String(e) }); }
    catch { res.destroy(); }
  } finally {
    log(`[waker] -> ${method} ${rawUrl} handled in ${fmtS(now() - startT)}`);
  }
});

// boot
server.setTimeout(0);
server.listen(PORT, () => {
  console.log(`[waker] listening on ${PORT} | idle-stop=${IDLE_STOP_SECONDS}s | no-stop-before=${NO_STOP_BEFORE_SECONDS}s | health-timeout=${fmtS(HEALTH_TIMEOUT_MS)}`);

  // Start GPU monitoring (pass dockerRequest wrapper as minimal dockerode)
  const dockerode = { listContainers: () => dockerRequest("GET", d("/containers/json?all=false")) };
  startMonitoring(dockerode).catch(e => err("[waker] gpu-monitor error:", e?.message || e));
});
setInterval(tick, TICK_MS);
process.on("unhandledRejection", (e) => err("[waker] unhandledRejection:", e?.message || e));
process.on("uncaughtException", (e) => err("[waker] uncaughtException:", e?.message || e));

