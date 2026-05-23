import { existsSync, readFileSync } from "node:fs";

const ALLOWED_IDLE_ACTIONS = new Set(["observe", "block", "stop-idle", "stop-always"]);
export const SUPPORTED_WORKLOAD_GPU_POLICIES = new Set(["external-exclusive", "observe"]);

function formatPath(filePath) {
  return filePath || "<inline-workloads-config>";
}

function fail(filePath, message) {
  throw new Error(`[workloads-config] ${formatPath(filePath)}: ${message}`);
}

function optionalString(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function optionalBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

export function parseWorkloadGpuPolicy(value, fallback = "external-exclusive") {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (!normalized) return fallback;
  return SUPPORTED_WORKLOAD_GPU_POLICIES.has(normalized) ? normalized : null;
}

export function normalizeWorkloadsConfig(raw, filePath) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(filePath, "top-level value must be a JSON object");
  }

  const rawWorkloads = raw.workloads ?? {};
  if (!rawWorkloads || typeof rawWorkloads !== "object" || Array.isArray(rawWorkloads)) {
    fail(filePath, "'workloads' must be a JSON object when present");
  }

  const workloads = {};
  const byContainer = {};
  const entries = [];

  for (const [id, value] of Object.entries(rawWorkloads)) {
    if (!id.trim()) {
      fail(filePath, "workload ids must not be empty");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail(filePath, `workload '${id}' must be an object`);
    }

    const container = optionalString(value.container);
    if (!container) {
      fail(filePath, `workload '${id}' is missing required field 'container'`);
    }
    if (byContainer[container]) {
      fail(filePath, `container '${container}' is assigned to both '${byContainer[container]}' and '${id}'`);
    }

    const idleAction = optionalString(value.idleAction, "observe");
    if (!ALLOWED_IDLE_ACTIONS.has(idleAction)) {
      fail(filePath, `workload '${id}' has invalid idleAction '${idleAction}'`);
    }

    const gpuPolicy = parseWorkloadGpuPolicy(value.gpuPolicy, "external-exclusive");
    if (!gpuPolicy) {
      fail(filePath, `workload '${id}' has invalid gpuPolicy '${value.gpuPolicy}'`);
    }

    const entry = {
      id,
      name: id,
      container,
      kind: optionalString(value.kind, "external"),
      role: optionalString(value.role, "external-gpu"),
      healthUrl: optionalString(value.healthUrl),
      busyUrl: optionalString(value.busyUrl),
      gpuPolicy,
      idleAction,
      restartAfterExclusiveLlm: optionalBoolean(value.restartAfterExclusiveLlm, false),
      source: "config"
    };

    workloads[id] = entry;
    byContainer[container] = id;
    entries.push(entry);
  }

  return { workloads, byContainer, entries };
}

export function loadWorkloadsConfig(filePath) {
  if (!filePath || !String(filePath).trim()) {
    return normalizeWorkloadsConfig({ workloads: {} }, filePath);
  }

  if (!existsSync(filePath)) {
    return normalizeWorkloadsConfig({ workloads: {} }, filePath);
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(filePath, `invalid JSON (${error.message})`);
  }

  return normalizeWorkloadsConfig(raw, filePath);
}
