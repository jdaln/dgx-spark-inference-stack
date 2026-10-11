// Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
// Records memory use per main-model session to a CSV file, served by /debug/gpu-stats.
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execAsync = promisify(exec);

const STATS_FILE = process.env.STATS_FILE || '/stats/gpu_memory_stats.csv';
const MONITOR_INTERVAL_MS = Number(process.env.MONITOR_INTERVAL_MS || 5000);

async function ensureStatsDir() {
  const dir = path.dirname(STATS_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

// GPU and system RAM are one pool on DGX Spark, so `free -m` measures GPU memory use.
async function getGPUMemory() {
  try {
    const { stdout } = await execAsync('free -m');
    // Second line, second column: used MB.
    const lines = stdout.trim().split('\n');
    const memLine = lines[1]; // Mem: line
    const values = memLine.split(/\s+/);
    const total = parseInt(values[1]);
    const used = parseInt(values[2]);
    return { used, total, timestamp: Date.now() };
  } catch (err) {
    console.error('[gpu-monitor] Error reading memory:', err.message);
    return null;
  }
}

// The running main model, judged by the waker's own predicate so the always-on utility
// helper is never credited with the main lane's memory.
async function getRunningModel(dockerode, isMainModel) {
  try {
    const containers = await dockerode.listContainers({ all: false });
    for (const container of containers) {
      for (const raw of container.Names || []) {
        const name = raw.replace(/^\//, '');
        if (isMainModel(name, container)) return name;
      }
    }
  } catch (err) {
    console.error('[gpu-monitor] Error listing containers:', err.message);
  }
  return null;
}

const sessions = new Map(); // model -> { start, min, max, sum, count }

function startSession(model) {
  if (!sessions.has(model)) {
    sessions.set(model, {
      start: Date.now(),
      min: Infinity,
      max: 0,
      sum: 0,
      count: 0
    });
    console.log(`[gpu-monitor] Started tracking session for ${model}`);
  }
}

function addSample(model, memoryMB) {
  const session = sessions.get(model);
  if (!session) return;

  session.min = Math.min(session.min, memoryMB);
  session.max = Math.max(session.max, memoryMB);
  session.sum += memoryMB;
  session.count++;
}

async function endSession(model) {
  const session = sessions.get(model);
  if (!session || session.count === 0) {
    sessions.delete(model);
    return;
  }

  const mean = session.sum / session.count;
  const duration = Date.now() - session.start;
  const minMB = session.min === Infinity ? 0 : session.min;

  await appendStats({
    timestamp: new Date(session.start).toISOString(),
    model,
    duration_sec: Math.round(duration / 1000),
    samples: session.count,
    min_mb: minMB,
    mean_mb: Math.round(mean),
    max_mb: session.max,
  });

  console.log(`[gpu-monitor] Session ended for ${model}: min=${minMB}MB, mean=${Math.round(mean)}MB, max=${session.max}MB`);
  sessions.delete(model);
}

async function appendStats(stats) {
  await ensureStatsDir();

  let needsHeader = false;
  try {
    await fs.access(STATS_FILE);
  } catch {
    needsHeader = true;
  }

  const csvLine = needsHeader
    ? 'timestamp,model,duration_sec,samples,min_mb,mean_mb,max_mb\n'
    : '';

  const row = `${stats.timestamp},${stats.model},${stats.duration_sec},${stats.samples},${stats.min_mb},${stats.mean_mb},${stats.max_mb}\n`;

  await fs.appendFile(STATS_FILE, csvLine + row);
}

export async function startMonitoring(dockerode, { isMainModel }) {
  console.log(`[gpu-monitor] Starting GPU memory monitoring (interval: ${MONITOR_INTERVAL_MS}ms)`);
  console.log(`[gpu-monitor] Stats file: ${STATS_FILE}`);

  let lastModel = null;

  setInterval(async () => {
    const currentModel = await getRunningModel(dockerode, isMainModel);
    const gpuMem = await getGPUMemory();

    if (!gpuMem) return;

    if (currentModel !== lastModel) {
      if (lastModel) {
        await endSession(lastModel);
      }
      if (currentModel) {
        startSession(currentModel);
      }
      lastModel = currentModel;
    }

    if (currentModel && sessions.has(currentModel)) {
      addSample(currentModel, gpuMem.used);
    }
  }, MONITOR_INTERVAL_MS);
}

export async function getModelStats(model) {
  try {
    const content = await fs.readFile(STATS_FILE, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const header = lines[0].split(',');

    const modelStats = lines.slice(1)
      .map(line => {
        const values = line.split(',');
        return Object.fromEntries(header.map((h, i) => [h, values[i]]));
      })
      .filter(s => s.model === model);

    if (modelStats.length === 0) return null;

    const mins = modelStats.map(s => parseInt(s.min_mb || 0)).filter(v => v > 0);
    const maxs = modelStats.map(s => parseInt(s.max_mb || 0)).filter(v => v > 0);
    const means = modelStats.map(s => parseInt(s.mean_mb || 0)).filter(v => v > 0);

    const allSessions = {
      sessions: modelStats.length,
      total_duration_sec: modelStats.reduce((sum, s) => sum + parseInt(s.duration_sec || 0), 0),
      min_mb: mins.length > 0 ? Math.min(...mins) : 0,
      max_mb: maxs.length > 0 ? Math.max(...maxs) : 0,
      mean_mb: means.length > 0 ? Math.round(means.reduce((a, b) => a + b, 0) / means.length) : 0,
      last_used: modelStats[modelStats.length - 1].timestamp,
    };

    return allSessions;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function getAllStats() {
  try {
    const content = await fs.readFile(STATS_FILE, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length <= 1) return {};

    const header = lines[0].split(',');
    const rows = lines.slice(1).map(line => {
      const values = line.split(',');
      return Object.fromEntries(header.map((h, i) => [h, values[i]]));
    });

    const byModel = {};
    for (const row of rows) {
      if (!byModel[row.model]) {
        byModel[row.model] = [];
      }
      byModel[row.model].push(row);
    }

    const result = {};
    for (const [model, sessions] of Object.entries(byModel)) {
      const mins = sessions.map(s => parseInt(s.min_mb || 0)).filter(v => v > 0);
      const maxs = sessions.map(s => parseInt(s.max_mb || 0)).filter(v => v > 0);
      const means = sessions.map(s => parseInt(s.mean_mb || 0)).filter(v => v > 0);

      result[model] = {
        sessions: sessions.length,
        total_duration_sec: sessions.reduce((sum, s) => sum + parseInt(s.duration_sec || 0), 0),
        min_mb: mins.length > 0 ? Math.min(...mins) : 0,
        max_mb: maxs.length > 0 ? Math.max(...maxs) : 0,
        mean_mb: means.length > 0 ? Math.round(means.reduce((a, b) => a + b, 0) / means.length) : 0,
        last_used: sessions[sessions.length - 1].timestamp,
      };
    }

    return result;
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    console.error('[gpu-monitor] Error reading stats:', err.message);
    return {};
  }
}

