import { parseWorkloadGpuPolicy } from "../shared/workloads-config.mjs";

export const SUPPORTED_EXTERNAL_GPU_POLICIES = new Set(["observe", "block"]);

export function parseNameSet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

export function parseExternalGpuPolicy(value, fallback = "observe") {
  const normalized = String(value || fallback).trim();
  return SUPPORTED_EXTERNAL_GPU_POLICIES.has(normalized) ? normalized : fallback;
}

export function containerNames(containerSummary) {
  return (containerSummary?.Names || []).map((raw) => raw.replace(/^\//, ""));
}

export function containerLabels(containerSummaryOrInspect) {
  return (
    containerSummaryOrInspect?.Labels ||
    containerSummaryOrInspect?.Config?.Labels ||
    {}
  );
}

export function isManagedLlm(containerSummary, name, { managePrefix, ignore }) {
  const labels = containerLabels(containerSummary);
  return (
    labels["dgx.spark.managed"] === "true" ||
    (name.startsWith(managePrefix) && !ignore.has(name))
  );
}

export function isExternalGpuWorkload(containerSummary, name, externalNames) {
  const labels = containerLabels(containerSummary);
  if (labels["dgx.spark.gpu-workload"] === "true") return true;
  return externalNames.has(name);
}

function parseBooleanLabel(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

export function isBlockingExternalWorkload(workload) {
  return workload?.policy === "external-exclusive";
}

export function summarizeExternalWorkload(containerSummary, name, { workloadsConfig, externalNames }) {
  const labels = containerLabels(containerSummary);
  const configId = workloadsConfig?.byContainer?.[name] || null;
  const configured = configId ? workloadsConfig.workloads[configId] : null;
  const hasWorkloadLabel = labels["dgx.spark.gpu-workload"] === "true";
  const configuredPolicy = configured?.gpuPolicy || "external-exclusive";

  if (!hasWorkloadLabel && !configured && !externalNames.has(name)) {
    return null;
  }

  const source = hasWorkloadLabel ? "label" : (configured ? "config" : "env");
  const workloadName =
    labels["dgx.spark.workload.name"] ||
    configured?.name ||
    configId ||
    name;

  const policy =
    parseWorkloadGpuPolicy(labels["dgx.spark.scheduler.policy"], configuredPolicy) ||
    configuredPolicy;

  return {
    name: workloadName,
    container: name,
    kind: labels["dgx.spark.workload.kind"] || configured?.kind || "external",
    role: configured?.role || "external-gpu",
    state: containerSummary?.State || containerSummary?.Status || "unknown",
    policy,
    healthUrl: labels["dgx.spark.health-url"] || configured?.healthUrl || null,
    busyUrl: labels["dgx.spark.busy-url"] || configured?.busyUrl || null,
    source,
    restartAfterExclusiveLlm:
      labels["dgx.spark.restart-after-exclusive-llm"] !== undefined
        ? parseBooleanLabel(labels["dgx.spark.restart-after-exclusive-llm"])
        : configured?.restartAfterExclusiveLlm ?? false
  };
}

export function discoverExternalWorkloads(containerSummaries, options) {
  const byContainer = new Map();

  for (const container of containerSummaries || []) {
    for (const name of containerNames(container)) {
      const summary = summarizeExternalWorkload(container, name, options);
      if (summary) {
        byContainer.set(summary.container, summary);
        break; // one entry per physical container; ignore remaining aliases
      }
    }
  }

  return [...byContainer.values()];
}
