// Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
// Lane cache expiry. ./cache/<container>/ holds each lane's compile, autotune and JIT caches:
// code the lane runs. Clearing them on a schedule bounds how long a corrupted or planted entry
// can survive. The lane rebuilds them on its next start.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MARKER = ".cache-created";
const DAY_MS = 24 * 60 * 60 * 1000;
const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function laneDir(root, container) {
  if (!CONTAINER_NAME.test(container)) throw new Error(`invalid container name '${container}'`);
  return path.join(root, container);
}

// Empties every cache directory of a stopped lane. The directories themselves stay: they are
// the container's bind-mount sources. Symlinks are removed, never followed.
export function wipeLaneCaches(root, container) {
  const dir = laneDir(root, container);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const child of fs.readdirSync(target)) fs.rmSync(path.join(target, child), { recursive: true, force: true });
    } else if (entry.name !== MARKER) {
      fs.rmSync(target, { force: true });
    }
  }
  fs.writeFileSync(path.join(dir, MARKER), "");
}

// Clears a stopped lane's caches once they are older than maxAgeDays; 0 or less disables it.
// The marker's mtime is when the caches were last cleared, or first seen.
// Returns "disabled", "absent", "marked", "fresh" or "wiped".
export function expireLaneCaches(root, container, maxAgeDays, nowMs = Date.now()) {
  if (!(maxAgeDays > 0)) return "disabled";
  const dir = laneDir(root, container);
  let stat;
  try { stat = fs.lstatSync(dir); } catch { return "absent"; }
  if (!stat.isDirectory()) return "absent";
  const marker = path.join(dir, MARKER);
  let since;
  try {
    since = fs.statSync(marker).mtimeMs;
  } catch {
    // First sighting starts the clock rather than forcing a slow start now.
    fs.writeFileSync(marker, "");
    return "marked";
  }
  if (nowMs - since < maxAgeDays * DAY_MS) return "fresh";
  wipeLaneCaches(root, container);
  return "wiped";
}

// tools/clean-caches.sh runs: node caches.js wipe <container>...
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...containers] = process.argv.slice(2);
  const root = process.env.CACHE_DIR || "/cache";
  if (command !== "wipe" || containers.length === 0) {
    console.error("usage: node caches.js wipe <container>...");
    process.exit(2);
  }
  for (const container of containers) {
    if (!fs.existsSync(laneDir(root, container))) {
      console.log(`${container}: no caches`);
      continue;
    }
    wipeLaneCaches(root, container);
    console.log(`${container}: caches cleared`);
  }
}
