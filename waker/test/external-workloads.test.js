import assert from "node:assert/strict";
import test from "node:test";

import { makeOpenAIError } from "../../shared/error-response.mjs";
import { normalizeWorkloadsConfig } from "../../shared/workloads-config.mjs";
import {
  discoverExternalWorkloads,
  isBlockingExternalWorkload,
  isExternalGpuWorkload,
  isManagedLlm,
  parseExternalGpuPolicy,
  parseNameSet
} from "../external-workloads.js";

test("OpenAI error helper returns the stable envelope", () => {
  assert.deepEqual(
    makeOpenAIError({
      message: "Missing model.",
      type: "invalid_request_error",
      param: "model",
      code: "missing_model"
    }),
    {
      error: {
        message: "Missing model.",
        type: "invalid_request_error",
        param: "model",
        code: "missing_model"
      }
    }
  );

  assert.equal(makeOpenAIError({ message: "bad", type: "unknown_type" }).error.type, "api_error");
});

test("workloads config validates entries and rejects duplicate containers", () => {
  const config = normalizeWorkloadsConfig(
    {
      workloads: {
        comfyui: {
          container: "comfyui",
          kind: "comfyui",
          healthUrl: "http://comfyui:8188/"
        }
      }
    },
    "<test>"
  );

  assert.equal(config.entries.length, 1);
  assert.equal(config.byContainer.comfyui, "comfyui");
  assert.equal(config.workloads.comfyui.idleAction, "observe");
  assert.equal(config.workloads.comfyui.gpuPolicy, "external-exclusive");
  assert.equal(config.workloads.comfyui.restartAfterExclusiveLlm, false);

  assert.throws(
    () => normalizeWorkloadsConfig(
      {
        workloads: {
          one: { container: "same" },
          two: { container: "same" }
        }
      },
      "<test>"
    ),
    /assigned to both/
  );

  assert.throws(
    () => normalizeWorkloadsConfig(
      {
        workloads: {
          invalid: { container: "comfyui", gpuPolicy: "shared" }
        }
      },
      "<test>"
    ),
    /invalid gpuPolicy/
  );
});

test("external workload discovery supports labels, config, and fallback names", () => {
  const config = normalizeWorkloadsConfig(
    {
      workloads: {
        configured: {
          container: "configured-comfy",
          kind: "comfyui",
          busyUrl: "http://configured-comfy:8188/queue"
        }
      }
    },
    "<test>"
  );
  const externalNames = parseNameSet("fallback-comfy");

  const containers = [
    {
      State: "running",
      Names: ["/labelled-comfy"],
      Labels: {
        "dgx.spark.gpu-workload": "true",
        "dgx.spark.workload.name": "comfyui",
        "dgx.spark.workload.kind": "comfyui",
        "dgx.spark.health-url": "http://labelled-comfy:8188/"
      }
    },
    {
      State: "running",
      Names: ["/configured-comfy"],
      Labels: {}
    },
    {
      State: "running",
      Names: ["/fallback-comfy"],
      Labels: {}
    }
  ];

  const discovered = discoverExternalWorkloads(containers, { workloadsConfig: config, externalNames });
  assert.deepEqual(discovered.map((item) => item.container).sort(), [
    "configured-comfy",
    "fallback-comfy",
    "labelled-comfy"
  ]);
  assert.equal(discovered.find((item) => item.container === "labelled-comfy").source, "label");
  assert.equal(discovered.find((item) => item.container === "configured-comfy").source, "config");
  assert.equal(discovered.find((item) => item.container === "fallback-comfy").source, "env");
});

test("external workload policies distinguish blocking and observe-only workloads", () => {
  const config = normalizeWorkloadsConfig(
    {
      workloads: {
        configured: {
          container: "configured-comfy",
          gpuPolicy: "observe"
        }
      }
    },
    "<test>"
  );
  const externalNames = parseNameSet("fallback-comfy");

  const containers = [
    {
      State: "running",
      Names: ["/labelled-comfy"],
      Labels: {
        "dgx.spark.gpu-workload": "true",
        "dgx.spark.scheduler.policy": "observe"
      }
    },
    {
      State: "running",
      Names: ["/configured-comfy"],
      Labels: {}
    },
    {
      State: "running",
      Names: ["/fallback-comfy"],
      Labels: {}
    }
  ];

  const discovered = discoverExternalWorkloads(containers, { workloadsConfig: config, externalNames });
  const labelled = discovered.find((item) => item.container === "labelled-comfy");
  const configured = discovered.find((item) => item.container === "configured-comfy");
  const fallback = discovered.find((item) => item.container === "fallback-comfy");

  assert.equal(labelled.policy, "observe");
  assert.equal(configured.policy, "observe");
  assert.equal(fallback.policy, "external-exclusive");
  assert.equal(isBlockingExternalWorkload(labelled), false);
  assert.equal(isBlockingExternalWorkload(configured), false);
  assert.equal(isBlockingExternalWorkload(fallback), true);
});

test("managed and external predicates preserve prefix fallback behavior", () => {
  const ignore = new Set(["vllm-waker"]);
  assert.equal(isManagedLlm({ Labels: {} }, "vllm-sample", { managePrefix: "vllm-", ignore }), true);
  assert.equal(isManagedLlm({ Labels: {} }, "vllm-waker", { managePrefix: "vllm-", ignore }), false);
  assert.equal(isManagedLlm({ Labels: { "dgx.spark.managed": "true" } }, "custom", { managePrefix: "vllm-", ignore }), true);

  const externalNames = parseNameSet("comfyui");
  assert.equal(isExternalGpuWorkload({ Labels: {} }, "comfyui", externalNames), true);
  assert.equal(isExternalGpuWorkload({ Labels: { "dgx.spark.gpu-workload": "true" } }, "custom-comfy", externalNames), true);
  assert.equal(isExternalGpuWorkload({ Labels: {} }, "other", externalNames), false);
});

test("unsupported external GPU policy falls back to observe for the MVP", () => {
  assert.equal(parseExternalGpuPolicy("block"), "block");
  assert.equal(parseExternalGpuPolicy("stop-idle"), "observe");
});
