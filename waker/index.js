// index.js — docker-waker (ESM, single-tenant mode)

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { makeOpenAIError, writeOpenAIError } from "../shared/error-response.mjs";
import { loadModelsConfig, resolveHealthUrl as resolveConfiguredHealthUrl } from "../shared/models-config.mjs";
import { loadWorkloadsConfig } from "../shared/workloads-config.mjs";
import {
  containerNames,
  discoverExternalWorkloads,
  isBlockingExternalWorkload,
  isManagedLlm,
  parseExternalGpuPolicy,
  parseNameSet
} from "./external-workloads.js";
import { startMonitoring, getModelStats, getAllStats } from "./gpu-monitor.js";

// -------- config --------
const PORT = Number(process.env.PORT || 18080);
const MANAGE_PREFIX = process.env.MANAGE_PREFIX || "vllm-";
const IDLE_STOP_SECONDS = Number(process.env.IDLE_STOP_SECONDS || 0); // 0=disabled
const NO_STOP_BEFORE_SECONDS = Number(process.env.NO_STOP_BEFORE_SECONDS || 30);
const HEALTH_TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS || 900_000);
const DOCKER_STOP_TIMEOUT_SECONDS = Number(process.env.DOCKER_STOP_TIMEOUT_SECONDS || 5);
const TICK_MS = Number(process.env.TICK_MS || 1000);
const STOP_DEBOUNCE_MS = Number(process.env.STOP_DEBOUNCE_MS || 20_000);
const BUSY_STATUS_CODE = Number(process.env.BUSY_STATUS_CODE || 429); // 429 = Too Many Requests (rate_limit_error)
const MODELS_CONFIG_PATH = process.env.MODELS_CONFIG_PATH || "/config/models.json";
const MODEL_HEALTH_URL_TEMPLATE = process.env.MODEL_HEALTH_URL_TEMPLATE || "http://{name}:8000/health";
const EXTERNAL_GPU_POLICY = parseExternalGpuPolicy(process.env.EXTERNAL_GPU_POLICY || "observe");
const EXTERNAL_GPU_CONTAINER_NAMES = parseNameSet(process.env.EXTERNAL_GPU_CONTAINER_NAMES || "");
const WORKLOADS_CONFIG_PATH = process.env.WORKLOADS_CONFIG_PATH || "";
const EXTERNAL_WORKLOAD_PROBE_TIMEOUT_MS = Number(process.env.EXTERNAL_WORKLOAD_PROBE_TIMEOUT_MS || 3000);
const EXTERNAL_BUSY_RETRY_AFTER_SECONDS = Number(process.env.EXTERNAL_BUSY_RETRY_AFTER_SECONDS || 30);

const DOCKER_HOST = process.env.DOCKER_HOST || "unix:///var/run/docker.sock";
const DOCKER_API_VERSION = process.env.DOCKER_API_VERSION || "";

const VERBOSE = (process.env.VERBOSE || "1") !== "0";

// -------- tiny utils --------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const now = () => Date.now();
const fmtS = (ms) => `${Math.floor(ms / 1000)}s`;
function log(...a) { if (VERBOSE) console.log(...a); }
function warn(...a) { console.warn(...a); }
function err(...a) { console.error(...a); }

const MODELS_CONFIG = loadModelsConfig(MODELS_CONFIG_PATH);
const WORKLOADS_CONFIG = loadWorkloadsConfig(WORKLOADS_CONFIG_PATH);
const MODELS_MAP = MODELS_CONFIG.modelMap;
const UTILITY_CONTAINER = MODELS_CONFIG.utilityContainer;
const EXCLUSIVE_CONTAINERS = new Set(MODELS_CONFIG.exclusiveContainers);
const IGNORE = new Set(
  (process.env.IGNORE_NAMES || "vllm-gateway,vllm-waker,vllm-request-validator")
    .split(",").map(s => s.trim()).filter(Boolean)
);
if (UTILITY_CONTAINER) {
  IGNORE.add(UTILITY_CONTAINER);
}
const isManaged = (n, containerSummary = {}) => isManagedLlm(containerSummary, n, { managePrefix: MANAGE_PREFIX, ignore: IGNORE });

function resolveModelEntry(modelKey) {
  return MODELS_CONFIG.byModel[modelKey] || null;
}

function resolveContainerName(modelKey) {
  const entry = resolveModelEntry(modelKey);
  if (entry) return entry.container;
  return modelKey.startsWith(MANAGE_PREFIX) ? modelKey : `${MANAGE_PREFIX}${modelKey}`;
}

function resolveHealthUrl(modelKey, containerName) {
  return resolveConfiguredHealthUrl(MODELS_CONFIG, modelKey, containerName, MODEL_HEALTH_URL_TEMPLATE);
}

log("[waker] Loaded models config:", {
  path: MODELS_CONFIG_PATH,
  models: Object.keys(MODELS_MAP).length,
  utilityContainer: UTILITY_CONTAINER,
  exclusiveContainers: [...EXCLUSIVE_CONTAINERS]
});
log("[waker] External workload config:", {
  path: WORKLOADS_CONFIG_PATH || null,
  configuredWorkloads: WORKLOADS_CONFIG.entries.length,
  externalGpuPolicy: EXTERNAL_GPU_POLICY,
  externalGpuContainerNames: [...EXTERNAL_GPU_CONTAINER_NAMES],
  externalWorkloadProbeTimeoutMs: EXTERNAL_WORKLOAD_PROBE_TIMEOUT_MS
});

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
const d = (p) => (DOCKER_API_VERSION ? `/${DOCKER_API_VERSION}${p}` : p);
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
const healthyOnce = new Set();

// -------- busy helper --------
class WakerHttpError extends Error {
  constructor({ statusCode = 500, message, type = "api_error", param = null, code = "internal_error", headers = {}, info = {} }) {
    super(message || "Unexpected waker error");
    this.name = "WakerHttpError";
    this.statusCode = statusCode;
    this.type = type;
    this.param = param;
    this.code = code;
    this.headers = headers;
    this.info = info;
  }
}

class BusyError extends Error {
  constructor({ statusCode = BUSY_STATUS_CODE, message, type = "rate_limit_error", param = "model", code = "model_busy", headers = {}, info = {} }) {
    super(message || "busy");
    this.name = "BusyError";
    this.statusCode = statusCode;
    this.type = type;
    this.param = param;
    this.code = code;
    this.headers = headers;
    this.info = info;
  }
}

async function getRunningManagedExcept(exceptName) {
  let cs = [];
  try { cs = await listContainers(true); } catch (e) { err("[waker] docker list error:", e.message || e); }
  const names = new Set();
  for (const c of cs) {
    if (c.State !== "running") continue;
    for (const raw of c.Names || []) {
      const n = raw.replace(/^\//, "");
      if (!isManaged(n, c)) continue;
      if (n === exceptName) continue;
      names.add(n);
    }
  }
  return [...names];
}

async function getRunningExternalWorkloads() {
  let cs = [];
  try {
    cs = await listContainers(true);
  } catch (e) {
    err("[waker] docker list error:", e.message || e);
    return [];
  }

  const running = cs.filter((container) => container.State === "running");
  return discoverExternalWorkloads(running, {
    workloadsConfig: WORKLOADS_CONFIG,
    externalNames: EXTERNAL_GPU_CONTAINER_NAMES
  });
}

async function getRunningManagedSummaries() {
  let cs = [];
  try {
    cs = await listContainers(true);
  } catch (e) {
    err("[waker] docker list error:", e.message || e);
    return [];
  }

  const out = [];
  const seen = new Set();
  const debugIgnore = new Set(IGNORE);
  if (UTILITY_CONTAINER) {
    debugIgnore.delete(UTILITY_CONTAINER);
  }
  for (const c of cs) {
    if (c.State !== "running") continue;
    for (const n of containerNames(c)) {
      if (!isManagedLlm(c, n, { managePrefix: MANAGE_PREFIX, ignore: debugIgnore }) || seen.has(n)) continue;
      seen.add(n);
      const modelId = MODELS_CONFIG.byContainer[n] || null;
      out.push({
        name: n,
        model: modelId,
        kind: modelId ? "llm" : "managed",
        lifecycle: modelId ? MODELS_CONFIG.byModel[modelId]?.lifecycle || "normal" : "unknown",
        state: c.State
      });
    }
  }
  return out;
}

async function withExternalHealth(workload) {
  if (!workload.healthUrl) {
    return { ...workload, health: "unknown", queue: "unknown" };
  }
  const ok = await httpOk(workload.healthUrl, EXTERNAL_WORKLOAD_PROBE_TIMEOUT_MS);
  return { ...workload, health: ok ? "ok" : "unreachable", queue: "unknown" };
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
      healthUrl: resolveHealthUrl(name, name),
      state: insp?.State?.Status || insp?.State?.State || "unknown"
    };
  } catch {
    return { name, state: "unknown" };
  }
}

// -------- ensure (start + wait) --------
let ensureQueue = Promise.resolve();

function withEnsureLock(fn) {
  const run = ensureQueue.then(fn, fn);
  ensureQueue = run.catch(() => {});
  return run;
}

async function ensureModel(modelKey) {
  return withEnsureLock(() => ensureModelLocked(modelKey));
}

async function ensureModelLocked(modelKey) {
  const entry = resolveModelEntry(modelKey);
  if (!entry) {
    throw new WakerHttpError({
      statusCode: 404,
      message: `Model '${modelKey}' is not configured in models.json.`,
      type: "not_found_error",
      param: "model",
      code: "model_not_found"
    });
  }

  const name = entry.container || resolveContainerName(modelKey);
  log(`[waker] ensure request for model key: ${modelKey} -> container: ${name}`);

  // Set starting state immediately to prevent tick() race
  starting.set(name, true);

  try {
    // single-tenant guard
    if (isManaged(name)) {
      const others = await getRunningManagedExcept(name);
      if (others.length > 0) {
        const current = await getContainerSummary(others[0]);
        const retryAfterSec = current.timeUntilReleaseSec ?? Math.max(1, Math.ceil(HEALTH_TIMEOUT_MS / 1000));
        const busyModelId = MODELS_CONFIG.byContainer[current.name] || current.name;
        const releaseHint = current.willAutoStop && current.timeUntilReleaseSec !== null
          ? `Expected to auto-stop in ~${current.timeUntilReleaseSec}s.`
          : "It will not auto-stop; stop it manually to free the GPU.";
        log(`[waker] BUSY: ${current.name} is running; refusing to start ${name}.`);
        throw new BusyError({
          message: `Model '${modelKey}' cannot start because '${busyModelId}' is already running. ${releaseHint}`,
          code: "model_busy",
          headers: {
            "Retry-After": String(retryAfterSec),
            "X-DGX-Busy-Container": current.name || "unknown",
            "X-DGX-Busy-Model": MODELS_CONFIG.byContainer[current.name] || current.name || "unknown",
            "X-Busy-Model": current.name || "unknown",
            "X-Model-Uptime-Sec": String(current.uptimeSec || 0),
            "X-Model-Idle-Sec": String(current.idleSec || 0),
            "X-Time-Until-Release-Sec": String(current.timeUntilReleaseSec || retryAfterSec),
            "X-Model-Will-Auto-Stop": String(current.willAutoStop || false)
          },
          info: {
            busy: true,
            currentModel: current,
            running: await Promise.all(others.map(getContainerSummary)),
            retryAfterSec
          }
        });
      }
    }

    if (entry.lifecycle !== "utility") {
      const runningExternal = await getRunningExternalWorkloads();
      const blockingExternal = runningExternal.filter(isBlockingExternalWorkload);
      if (runningExternal.length > 0) {
        if (EXTERNAL_GPU_POLICY === "observe") {
          log(`[waker] external GPU workload observed while starting ${name}: ${runningExternal.map((w) => w.container).join(", ")}`);
        } else if (EXTERNAL_GPU_POLICY === "block" && blockingExternal.length > 0) {
          const blocker = blockingExternal[0];
          throw new BusyError({
            statusCode: 429,
            message: `GPU is busy with external workload '${blocker.name}'. Retry in ${EXTERNAL_BUSY_RETRY_AFTER_SECONDS}s, stop it manually, or set EXTERNAL_GPU_POLICY=observe.`,

            code: "external_gpu_busy",
            headers: {
              "Retry-After": String(EXTERNAL_BUSY_RETRY_AFTER_SECONDS),
              "X-DGX-Busy-Workload": blocker.name || blocker.container || "unknown",
              "X-DGX-External-GPU-Policy": EXTERNAL_GPU_POLICY
            },
            info: {
              busy: true,
              externalBusy: true,
              runningExternal,
              retryAfterSec: EXTERNAL_BUSY_RETRY_AFTER_SECONDS
            }
          });
        } else if (EXTERNAL_GPU_POLICY === "block") {
          log(
            `[waker] external GPU workloads observed while starting ${name}, but none are configured to block managed models: ${runningExternal.map((w) => `${w.container}:${w.policy}`).join(", ")}`
          );
        }
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
      warn(`[waker] container inspect failed for ${name}:`, e.message || e);
      throw new WakerHttpError({
        statusCode: 404,
        message: `Container '${name}' for model '${modelKey}' is not available. Create it with the models profile before requesting the model.`,
        type: "not_found_error",
        param: "model",
        code: "model_not_found"
      });
    }

    const running = !!insp?.State?.Running;
    if (!running) {
      log(`[waker] starting ${name}...`);
      try {
        await startContainer(name);
      } catch (e) {
        warn(`[waker] start failed for ${name}:`, e.message || e);
        throw new WakerHttpError({
          statusCode: 500,
          message: `Docker failed to start container '${name}' for model '${modelKey}'. Check waker logs for details.`,
          type: "api_error",
          param: "model",
          code: "internal_error"
        });
      }
      await sleep(300);
      insp = await inspectContainer(name);
    }

    const started = Date.parse(insp?.State?.StartedAt || "") || now();
    startAtMs.set(name, started);
    lastSeenMs.set(name, started);

    const url = resolveHealthUrl(modelKey, name);
    log(`[waker] waiting health ${url} up to ${fmtS(HEALTH_TIMEOUT_MS)}`);
    try {
      await waitHttpOk(url, now() + HEALTH_TIMEOUT_MS);
    } catch (e) {
      throw new WakerHttpError({
        statusCode: 503,
        message: `Model '${modelKey}' did not report healthy before the health timeout.`,
        type: "service_unavailable_error",
        param: "model",
        code: "model_health_timeout",
        headers: {
          "Retry-After": String(Math.max(1, Math.ceil(HEALTH_TIMEOUT_MS / 1000)))
        },
        info: { healthUrl: url, error: e.message || String(e) }
      });
    }

    lastSeenMs.set(name, now());
    healthyOnce.add(name);
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
  const entry = resolveModelEntry(modelKey);
  if (!entry) {
    return {
      status: "error",
      statusCode: 404,
      message: `Model '${modelKey}' is not configured in models.json.`,
      type: "not_found_error",
      param: "model",
      code: "model_not_found"
    };
  }

  const name = entry.container || resolveContainerName(modelKey);
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
    return {
      status: "error",
      message: `Container '${name}' for model '${modelKey}' is not available.`,
      statusCode: 404,
      type: "not_found_error",
      param: "model",
      code: "model_not_found"
    };
  }

  // 3. If it's already running, check its health.
  if (insp?.State?.Running) {
    const healthUrl = resolveHealthUrl(modelKey, name);
    const isHealthy = await httpOk(healthUrl, 2000); // Quick 2s timeout for check.
    if (isHealthy) {
      log(`[waker] READY on check: ${name} is running and healthy.`);
      healthyOnce.add(name);
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
        if (isManaged(n, c)) managed.add(n);
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
        lastSeenMs.set(name, now());
        healthyOnce.delete(name);
        continue; // grace on fresh start
      }

      const healthStatus = insp?.State?.Health?.Status || "";
      if (healthStatus === "healthy") {
        healthyOnce.add(name);
      }

      if (starting.has(name) || healthStatus === "starting" || (healthStatus === "unhealthy" && !healthyOnce.has(name))) {
        lastSeenMs.set(name, now());
        continue;
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
  writeOpenAIError(res, 404, {
    message: msg,
    type: "not_found_error",
    param: null,
    code: "route_not_found"
  });
}

function writeWakerError(res, error) {
  const statusCode = error?.statusCode || 500;
  return json(
    res,
    statusCode,
    makeOpenAIError({
      message: error?.message || "Internal waker error.",
      type: error?.type || "api_error",
      param: error?.param ?? null,
      code: error?.code || "internal_error"
    }),
    error?.headers || {}
  );
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
      const runningManaged = await getRunningManagedSummaries();
      const runningExternal = await Promise.all((await getRunningExternalWorkloads()).map(withExternalHealth));
      return json(res, 200, {
        config: {
          PORT, MANAGE_PREFIX, IGNORE: [...IGNORE],
          IDLE_STOP_SECONDS, NO_STOP_BEFORE_SECONDS,
          HEALTH_TIMEOUT_MS, DOCKER_STOP_TIMEOUT_SECONDS,
          TICK_MS, STOP_DEBOUNCE_MS, MODELS_CONFIG_PATH,
          DOCKER_HOST, DOCKER_API_VERSION,
          EXTERNAL_GPU_POLICY,
          EXTERNAL_GPU_CONTAINER_NAMES: [...EXTERNAL_GPU_CONTAINER_NAMES],
          WORKLOADS_CONFIG_PATH,
          EXTERNAL_WORKLOAD_PROBE_TIMEOUT_MS
        },
        modelsConfig: {
          utilityContainer: UTILITY_CONTAINER,
          exclusiveContainers: [...EXCLUSIVE_CONTAINERS],
          modelMap: MODELS_MAP
        },
        startAtMs: Object.fromEntries(startAtMs),
        lastSeenMs: Object.fromEntries(lastSeenMs),
        lastStopMs: Object.fromEntries(lastStopMs),
        busyWith: current,
        runningManaged,
        runningExternal,
        externalGpuPolicy: EXTERNAL_GPU_POLICY,
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
      if (!stats) {
        return writeOpenAIError(res, 404, {
          message: `No GPU stats found for model '${model}'.`,
          type: "not_found_error",
          param: "model",
          code: "stats_not_found"
        });
      }
      return json(res, 200, { model, stats });
    }

    if (method === "POST" && u.pathname.startsWith("/touch/")) {
      const name = decodeURIComponent(u.pathname.split("/").pop());
      if (!isManaged(name)) {
        return writeOpenAIError(res, 400, {
          message: `Container '${name}' is not managed by this waker.`,
          type: "invalid_request_error",
          param: "model",
          code: "model_not_found"
        });
      }
      lastSeenMs.set(name, now());
      return json(res, 200, { ok: true, name, lastSeen: lastSeenMs.get(name) });
    }

    if (method === "POST" && (u.pathname === "/ensure" || u.pathname.startsWith("/ensure/"))) {
      const short =
        u.searchParams.get("model") ||
        (u.pathname.includes("/ensure/") ? decodeURIComponent(u.pathname.split("/").pop()) : null);
      if (!short) {
        return writeOpenAIError(res, 400, {
          message: "Missing model for ensure request.",
          type: "invalid_request_error",
          param: "model",
          code: "missing_model"
        });
      }
      try {
        const out = await ensureModel(short);
        return json(res, 200, { ok: true, ...out });
      } catch (e) {
        if (e instanceof BusyError) {
          return writeWakerError(res, e);
        }
        if (e instanceof WakerHttpError) {
          return writeWakerError(res, e);
        }
        return writeWakerError(res, new WakerHttpError({
          message: "Internal waker error.",
          type: "api_error",
          param: null,
          code: "internal_error",
          info: { error: e.message || String(e) }
        }));
      }
    }

    if (method === "POST" && u.pathname.startsWith("/check/")) {
      const modelKey = decodeURIComponent(u.pathname.split("/").pop());
      if (!modelKey) {
        return writeOpenAIError(res, 400, {
          message: "Missing model for check request.",
          type: "invalid_request_error",
          param: "model",
          code: "missing_model"
        });
      }

      const result = await checkModel(modelKey);

      if (result.status === "ready") {
        return json(res, 200, { status: "ready", model: result.name });
      }
      if (result.status === "busy") {
        const retryAfterSec = result.timeUntilReleaseSec || Math.max(1, Math.ceil(HEALTH_TIMEOUT_MS / 1000));
        const headers = {
          "Retry-After": String(retryAfterSec),
          "X-DGX-Busy-Container": result.name || "unknown",
          "X-DGX-Busy-Model": MODELS_CONFIG.byContainer[result.name] || result.name || "unknown"
        };
        return writeOpenAIError(res, 429, {
          message: `Model '${modelKey}' cannot start because managed LLM container '${result.name}' is already running. Retry when it is released.`,
          type: "rate_limit_error",
          param: "model",
          code: "model_busy"
        }, headers);
      }
      if (result.status === "initializing") {
        return json(res, 202, { status: "initializing", model: result.name, message: result.message });
      }
      return writeOpenAIError(res, result.statusCode || 500, {
        message: result.message || "Model check failed.",
        type: result.type || "api_error",
        param: result.param ?? null,
        code: result.code || "internal_error"
      });
    }

    return notFound(res);
  } catch (e) {
    err("[waker] handler error:", e?.message || e);
    try {
      return writeOpenAIError(res, 500, {
        message: "Internal waker error.",
        type: "api_error",
        param: null,
        code: "internal_error"
      });
    }
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
