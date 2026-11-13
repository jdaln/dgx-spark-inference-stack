// Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expireLaneCaches, wipeLaneCaches } from "../caches.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function laneWithCaches() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "waker-caches-"));
  const lane = path.join(root, "vllm-lane");
  fs.mkdirSync(path.join(lane, "vllm", "torch_compile_cache"), { recursive: true });
  fs.writeFileSync(path.join(lane, "vllm", "torch_compile_cache", "artifact"), "compiled");
  fs.mkdirSync(path.join(lane, "triton"), { recursive: true });
  fs.writeFileSync(path.join(lane, "triton", "kernel.so"), "kernel");
  return { root, lane };
}

function backdate(file, days) {
  const t = new Date(Date.now() - days * DAY_MS);
  fs.utimesSync(file, t, t);
}

test("expiry is off at 0 days and skips lanes without caches", () => {
  const { root, lane } = laneWithCaches();
  assert.equal(expireLaneCaches(root, "vllm-lane", 0), "disabled");
  assert.equal(fs.existsSync(path.join(lane, ".cache-created")), false);
  assert.equal(expireLaneCaches(root, "vllm-other", 14), "absent");
});

test("the first sighting starts the clock and keeps the caches", () => {
  const { root, lane } = laneWithCaches();
  assert.equal(expireLaneCaches(root, "vllm-lane", 14), "marked");
  assert.equal(fs.existsSync(path.join(lane, ".cache-created")), true);
  assert.equal(fs.existsSync(path.join(lane, "triton", "kernel.so")), true);
  assert.equal(expireLaneCaches(root, "vllm-lane", 14), "fresh");
  assert.equal(fs.existsSync(path.join(lane, "triton", "kernel.so")), true);
});

test("caches older than the limit are emptied, mount directories kept, clock restarted", () => {
  const { root, lane } = laneWithCaches();
  expireLaneCaches(root, "vllm-lane", 14);
  backdate(path.join(lane, ".cache-created"), 15);
  assert.equal(expireLaneCaches(root, "vllm-lane", 14), "wiped");
  assert.deepEqual(fs.readdirSync(path.join(lane, "vllm")), []);
  assert.deepEqual(fs.readdirSync(path.join(lane, "triton")), []);
  assert.ok(Date.now() - fs.statSync(path.join(lane, ".cache-created")).mtimeMs < 60_000);
  assert.equal(expireLaneCaches(root, "vllm-lane", 14), "fresh");
});

test("a wipe removes symlinks without touching their targets", () => {
  const { root, lane } = laneWithCaches();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "waker-outside-"));
  fs.writeFileSync(path.join(outside, "keep"), "host file");
  fs.symlinkSync(outside, path.join(lane, "vllm", "link-dir"));
  fs.symlinkSync(path.join(outside, "keep"), path.join(lane, "stray-link"));
  wipeLaneCaches(root, "vllm-lane");
  assert.deepEqual(fs.readdirSync(path.join(lane, "vllm")), []);
  assert.equal(fs.existsSync(path.join(lane, "stray-link")), false);
  assert.equal(fs.readFileSync(path.join(outside, "keep"), "utf8"), "host file");
});

test("container names cannot escape the cache root", () => {
  const { root } = laneWithCaches();
  assert.throws(() => expireLaneCaches(root, "../etc", 14), /invalid container name/);
  assert.throws(() => wipeLaneCaches(root, "a/b"), /invalid container name/);
});
