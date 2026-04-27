#!/usr/bin/env node

import { readFileSync } from "node:fs";

function usage() {
  console.error("usage: resolve-compose-service.mjs <compose-json> <models-json> <target>");
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalizeEnvironment(environment) {
  if (!environment) {
    return {};
  }

  if (Array.isArray(environment)) {
    const result = {};
    for (const entry of environment) {
      const text = String(entry);
      const splitIndex = text.indexOf("=");
      if (splitIndex === -1) {
        result[text] = "";
      } else {
        result[text.slice(0, splitIndex)] = text.slice(splitIndex + 1);
      }
    }
    return result;
  }

  return environment;
}

function normalizeCommand(command) {
  if (!command) {
    return [];
  }

  if (Array.isArray(command)) {
    return command.map((value) => String(value));
  }

  return [String(command)];
}

function quoteShell(value) {
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function findServedModelName(command) {
  const index = command.indexOf("--served-model-name");
  if (index === -1 || index + 1 >= command.length) {
    return null;
  }

  return command[index + 1];
}

if (process.argv.length !== 5) {
  usage();
}

const [, , composeJsonPath, modelsJsonPath, target] = process.argv;
const composeConfig = readJson(composeJsonPath);
const modelsConfig = readJson(modelsJsonPath);
const services = composeConfig.services ?? {};

const modelByContainer = new Map();
for (const [modelId, entry] of Object.entries(modelsConfig)) {
  if (entry && typeof entry.container === "string" && entry.container.length > 0) {
    modelByContainer.set(entry.container, modelId);
  }
}

const serviceEntries = Object.entries(services).map(([serviceName, service]) => {
  const command = normalizeCommand(service.command);
  return {
    serviceName,
    service,
    containerName: service.container_name ?? serviceName,
    command,
    servedModelName: findServedModelName(command),
    environment: normalizeEnvironment(service.environment)
  };
});

function makeResult(entry, explicitModelId = null) {
  const modelId = explicitModelId ?? modelByContainer.get(entry.containerName) ?? null;
  return {
    target,
    modelId,
    serviceName: entry.serviceName,
    containerName: entry.containerName,
    servedModelName: entry.servedModelName,
    image: entry.service.image ?? null,
    build: entry.service.build ?? null,
    command: entry.command,
    commandLine: entry.command.map(quoteShell).join(" "),
    environment: entry.environment,
    volumes: entry.service.volumes ?? [],
    healthcheck: entry.service.healthcheck ?? null,
    profiles: entry.service.profiles ?? []
  };
}

let resolved = null;

if (services[target]) {
  resolved = makeResult(serviceEntries.find((entry) => entry.serviceName === target));
}

if (!resolved && Object.hasOwn(modelsConfig, target)) {
  const containerName = modelsConfig[target]?.container;
  const matchingService = serviceEntries.find((entry) => entry.containerName === containerName);
  if (!matchingService) {
    console.error(`Model '${target}' maps to container '${containerName}', but no rendered compose service uses that container.`);
    process.exit(1);
  }
  resolved = makeResult(matchingService, target);
}

if (!resolved) {
  const matchingService = serviceEntries.find((entry) => entry.containerName === target);
  if (matchingService) {
    resolved = makeResult(matchingService);
  }
}

if (!resolved) {
  const matchingService = serviceEntries.find((entry) => entry.servedModelName === target);
  if (matchingService) {
    resolved = makeResult(matchingService);
  }
}

if (!resolved) {
  console.error(`Could not resolve '${target}' to a rendered compose service.`);
  process.exit(1);
}

console.log(JSON.stringify(resolved));