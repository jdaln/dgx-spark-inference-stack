import { readFileSync } from "node:fs";

const ALLOWED_TOOL_SUPPORT = new Set(["full", "force-required", "none"]);
const ALLOWED_LIFECYCLE = new Set(["normal", "utility", "exclusive"]);
const ALLOWED_VALIDATOR_PROFILES = new Set([
  "default",
  "small-no-tools",
  "coder-force-tools",
  "vl"
]);

function formatPath(filePath) {
  return filePath || "<inline-models-config>";
}

function fail(filePath, message) {
  throw new Error(`[models-config] ${formatPath(filePath)}: ${message}`);
}

function assertEnum(filePath, modelId, field, value, allowed) {
  if (!allowed.has(value)) {
    fail(
      filePath,
      `model '${modelId}' has invalid ${field} '${value}' (allowed: ${[...allowed].join(", ")})`
    );
  }
}

function assertPositiveInteger(filePath, modelId, field, value) {
  if (!Number.isInteger(value) || value < 1) {
    fail(filePath, `model '${modelId}' has invalid ${field} '${value}' (must be a positive integer)`);
  }
}

export function normalizeModelsConfig(raw, filePath) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(filePath, "top-level value must be a JSON object keyed by model id");
  }

  const byModel = {};
  const byContainer = {};
  const entries = [];
  let utilityModel = null;

  for (const [modelId, value] of Object.entries(raw)) {
    if (!modelId.trim()) {
      fail(filePath, "model ids must not be empty");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail(filePath, `model '${modelId}' must be an object`);
    }

    const container = typeof value.container === "string" ? value.container.trim() : "";
    if (!container) {
      fail(filePath, `model '${modelId}' is missing required field 'container'`);
    }
    if (byContainer[container]) {
      fail(filePath, `container '${container}' is assigned to both '${byContainer[container]}' and '${modelId}'`);
    }

    const port = value.port ?? 8000;
    const maxModelLen = value.maxModelLen;
    const toolSupport = value.toolSupport ?? "full";
    const validatorProfile = value.validatorProfile ?? "default";
    const lifecycle = value.lifecycle ?? "normal";
    const multimodal = value.multimodal ?? false;
    const experimental = value.experimental ?? false;
    const sourceRecipe = value.sourceRecipe ?? null;
    const notes = value.notes ?? null;

    assertPositiveInteger(filePath, modelId, "port", port);
    assertPositiveInteger(filePath, modelId, "maxModelLen", maxModelLen);
    assertEnum(filePath, modelId, "toolSupport", toolSupport, ALLOWED_TOOL_SUPPORT);
    assertEnum(filePath, modelId, "validatorProfile", validatorProfile, ALLOWED_VALIDATOR_PROFILES);
    assertEnum(filePath, modelId, "lifecycle", lifecycle, ALLOWED_LIFECYCLE);

    if (typeof multimodal !== "boolean") {
      fail(filePath, `model '${modelId}' has invalid multimodal '${multimodal}' (must be true or false)`);
    }
    if (typeof experimental !== "boolean") {
      fail(filePath, `model '${modelId}' has invalid experimental '${experimental}' (must be true or false)`);
    }
    if (sourceRecipe !== null && typeof sourceRecipe !== "string") {
      fail(filePath, `model '${modelId}' has invalid sourceRecipe '${sourceRecipe}' (must be a string)`);
    }
    if (notes !== null && typeof notes !== "string") {
      fail(filePath, `model '${modelId}' has invalid notes '${notes}' (must be a string)`);
    }

    if (lifecycle === "utility") {
      if (utilityModel) {
        fail(filePath, `utility lifecycle assigned to both '${utilityModel}' and '${modelId}'`);
      }
      utilityModel = modelId;
    }

    const upstream = `http://${container}:${port}`;
    const health = `${upstream}/health`;
    const entry = {
      model: modelId,
      container,
      port,
      maxModelLen,
      toolSupport,
      validatorProfile,
      lifecycle,
      multimodal,
      experimental,
      sourceRecipe,
      notes,
      upstream,
      health
    };

    entries.push(entry);
    byModel[modelId] = entry;
    byContainer[container] = modelId;
  }

  return {
    entries,
    byModel,
    byContainer,
    modelMap: Object.fromEntries(entries.map((entry) => [entry.model, entry.container])),
    utilityModel,
    utilityContainer: utilityModel ? byModel[utilityModel].container : null,
    exclusiveModels: entries.filter((entry) => entry.lifecycle === "exclusive").map((entry) => entry.model),
    exclusiveContainers: entries.filter((entry) => entry.lifecycle === "exclusive").map((entry) => entry.container)
  };
}

export function loadModelsConfig(filePath) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    fail(filePath, `unable to read file (${error.message})`);
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    fail(filePath, `invalid JSON (${error.message})`);
  }

  return normalizeModelsConfig(raw, filePath);
}
