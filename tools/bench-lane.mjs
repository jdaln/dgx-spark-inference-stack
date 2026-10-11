#!/usr/bin/env node
// Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
// Lane benchmark through the real gateway, so it measures what clients get and works for
// any engine behind the validator. Suites:
//   speed       single-stream decode tok/s (net of time to first token) on fixed prompts
//   prefill     time to first token and prefill tok/s at ~1k / 32k / 128k uncached tokens
//   throughput  aggregate and per-stream decode tok/s at several concurrency levels
//   quality     graded battery from lib/bench-quality.mjs, run at --quality-concurrency so
//               quality is measured under load, not just in isolation
// Speculative-decoding acceptance and preemptions are read from the lane container's
// /metrics when the engine exposes them (vLLM drops engine stats with --disable-log-stats).
import http from "node:http";
import https from "node:https";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildQualityCases, selfTest } from "./lib/bench-quality.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(SCRIPT_DIR, "..");
// Frozen copy of the soak bundle, so regenerating that bundle never changes bench inputs.
const FILLER_PATH = join(REPO_DIR, "tools/testdata/bench/filler.txt");
const BUNDLE_TOKENS_PER_COPY = 27000;

const SAMPLING = {
  default: {},
  greedy: { temperature: 0 },
  "qwen-instruct": { temperature: 0.7, top_p: 0.8, top_k: 20 },
};

const USAGE = `usage: bench-lane.mjs --model ID [--suites speed,prefill,throughput,quality] [--quick]
  [--quality-concurrency N] [--throughput-levels 1,2,4,8] [--throughput-per-worker N]
  [--speed-max-tokens N] [--speed-repeats N] [--prefill-sizes 1000,32000,128000]
  [--sampling default|greedy|qwen-instruct|JSON] [--thinking default|off] [--reasoning-effort X]
  [--label NAME] [--out PATH] [--url URL] [--api-key KEY] [--request-timeout-seconds N]
bench-lane.mjs --self-test [--with-sandbox]`;

function parseArgs(argv) {
  const config = {
    model: null,
    suites: ["speed", "prefill", "throughput", "quality"],
    quick: false,
    qualityConcurrency: 8,
    throughputLevels: [1, 2, 4, 8],
    throughputPerWorker: 2,
    speedMaxTokens: 512,
    speedRepeats: 1,
    prefillSizes: [1000, 32000, 128000],
    sampling: "default",
    thinking: "default",
    reasoningEffort: null,
    label: null,
    out: null,
    url: process.env.GATEWAY_URL || "http://127.0.0.1:8009",
    apiKey: process.env.VLLM_API_KEY || "63TestTOKEN0REPLACEME",
    requestTimeoutMs: 1300 * 1000,
    selfTest: false,
    withSandbox: false,
  };
  const list = (value) => value.split(",").map((v) => v.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--model": config.model = next(); break;
      case "--suites": config.suites = list(next()); break;
      case "--quick": config.quick = true; break;
      case "--quality-concurrency": config.qualityConcurrency = Number(next()); break;
      case "--throughput-levels": config.throughputLevels = list(next()).map(Number); break;
      case "--throughput-per-worker": config.throughputPerWorker = Number(next()); break;
      case "--speed-max-tokens": config.speedMaxTokens = Number(next()); break;
      case "--speed-repeats": config.speedRepeats = Number(next()); break;
      case "--prefill-sizes": config.prefillSizes = list(next()).map(Number); break;
      case "--sampling": config.sampling = next(); break;
      case "--thinking": config.thinking = next(); break;
      case "--reasoning-effort": config.reasoningEffort = next(); break;
      case "--label": config.label = next(); break;
      case "--out": config.out = next(); break;
      case "--url": config.url = next(); break;
      case "--api-key": config.apiKey = next(); break;
      case "--request-timeout-seconds": config.requestTimeoutMs = Number(next()) * 1000; break;
      case "--self-test": config.selfTest = true; break;
      case "--with-sandbox": config.withSandbox = true; break;
      case "-h": case "--help": console.log(USAGE); process.exit(0); break;
      default: console.error(`unknown argument: ${arg}\n${USAGE}`); process.exit(2);
    }
  }
  if (!config.selfTest && !config.model) {
    console.error(USAGE);
    process.exit(2);
  }
  return config;
}

function samplingParams(name) {
  if (SAMPLING[name]) return SAMPLING[name];
  try {
    return JSON.parse(name);
  } catch {
    console.error(`--sampling must be one of ${Object.keys(SAMPLING).join(", ")} or a JSON object`);
    process.exit(2);
  }
}

function buildBody(config, lane, request) {
  const body = { model: config.model, ...request, ...samplingParams(config.sampling) };
  if (config.reasoningEffort) body.reasoning_effort = config.reasoningEffort;
  if (config.thinking === "off") {
    if (lane.reasoningEffort === "graded" || lane.reasoningEffort === "binary") {
      body.reasoning_effort = "none";
    } else {
      body.chat_template_kwargs = { ...(body.chat_template_kwargs ?? {}), enable_thinking: false };
    }
  }
  return body;
}

// node:http, not fetch: undici's 300 s headers timeout would cut off long requests.
function request(config, path, body, { onEvent } = {}) {
  return new Promise((resolvePromise) => {
    const url = new URL(path, config.url);
    const payload = JSON.stringify(body);
    const started = performance.now();
    const lib = url.protocol === "https:" ? https : http;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolvePromise({ ...value, elapsedMs: performance.now() - started });
    };
    const req = lib.request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
        "content-length": Buffer.byteLength(payload),
      },
    }, (res) => {
      let raw = "";
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (!onEvent || res.statusCode !== 200) {
          raw += chunk;
          return;
        }
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            onEvent(JSON.parse(data), performance.now());
          } catch {
            // ignore keep-alive or malformed lines
          }
        }
      });
      res.on("end", () => {
        let json = null;
        if (raw) {
          try {
            json = JSON.parse(raw);
          } catch {
            json = null;
          }
        }
        finish({ status: res.statusCode, json, raw: json ? undefined : raw.slice(0, 300) });
      });
      res.on("error", (error) => finish({ status: 0, error: String(error) }));
    });
    req.setTimeout(config.requestTimeoutMs, () => req.destroy(new Error("client timeout")));
    req.on("error", (error) => finish({ status: 0, error: String(error) }));
    req.end(payload);
  });
}

const errorText = (res) => res.error ?? res.json?.error?.message ?? res.raw ?? `HTTP ${res.status}`;

async function timedStream(config, body) {
  const t0 = performance.now();
  let first = null;
  let last = null;
  let usage = null;
  let finishReason = null;
  const res = await request(config, "/v1/chat/completions", { ...body, stream: true, stream_options: { include_usage: true } }, {
    onEvent(event, now) {
      if (event.usage) usage = event.usage;
      const choice = event.choices?.[0];
      if (!choice) return;
      const delta = choice.delta ?? {};
      const produced = (delta.content?.length ?? 0) + (delta.reasoning?.length ?? 0) + (delta.reasoning_content?.length ?? 0) + (delta.tool_calls?.length ?? 0);
      if (produced > 0) {
        if (first === null) first = now;
        last = now;
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    },
  });
  const tokens = usage?.completion_tokens ?? 0;
  const decodeSeconds = first !== null && last > first ? (last - first) / 1000 : 0;
  return {
    status: res.status,
    error: res.status === 200 ? undefined : errorText(res),
    ttftMs: first === null ? null : first - t0,
    totalMs: performance.now() - t0,
    completionTokens: tokens,
    promptTokens: usage?.prompt_tokens ?? null,
    finish: finishReason,
    decodeTps: tokens > 1 && decodeSeconds > 0 ? (tokens - 1) / decodeSeconds : null,
  };
}

const median = (values) => {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};
const round = (x, digits = 1) => (x === null || x === undefined ? null : Number(x.toFixed(digits)));
const sum = (values) => values.reduce((a, b) => a + (b ?? 0), 0);

function speedPrompts(filler) {
  const user = (content) => [{ role: "user", content }];
  return [
    ["code", user("Write a Python class implementing an LRU cache with O(1) get and put, with docstrings and a short usage example.")],
    ["code-refactor", user("Refactor this JavaScript to async/await and add proper error handling:\n```js\nfunction load(url, cb){ fetch(url).then(r=>r.json()).then(d=>cb(null,d)).catch(e=>cb(e)); }\nfunction loadAll(urls, cb){ var out=[]; var n=0; urls.forEach(function(u,i){ load(u,function(e,d){ if(e) return cb(e); out[i]=d; if(++n===urls.length) cb(null,out); }); }); }\n```")],
    ["math", user("Prove that the square root of 2 is irrational. Then compute the sum of the first 50 odd numbers, showing each step.")],
    ["prose", user("Write a 400-word short story about a lighthouse keeper who receives an unexpected letter.")],
    ["technical", user("Explain how TCP congestion control works, covering slow start, congestion avoidance, fast retransmit and fast recovery.")],
    ["json", user("Generate a JSON array of 8 fictional users. Each user has id, name, email, signup_date (YYYY-MM-DD) and interests (an array of 3 strings). Output only the JSON.")],
    ["summarize", user(`Summarize the following document in 6 bullet points:\n\n${filler.slice(0, 8000)}`)],
    ["agent", [
      { role: "system", content: "You are a coding agent working in a JavaScript repository." },
      { role: "user", content: "The tests fail with \"TypeError: Cannot read properties of undefined (reading 'map')\" in src/list.js line 4." },
      { role: "assistant", content: "Please paste src/list.js so I can see the code around line 4." },
      { role: "user", content: "```js\nexport function names(response) {\n  const users = response.data.users;\n  // users may be missing when the API returns an empty page\n  return users.map((u) => u.name).filter(Boolean);\n}\n```\nWhat is the fix? Show the corrected function and a test for it." },
    ]],
  ].map(([category, messages]) => ({ category, messages }));
}

function readLane(model) {
  const models = JSON.parse(readFileSync(join(REPO_DIR, "models.json"), "utf8"));
  const lane = models[model];
  if (!lane) {
    console.error(`model '${model}' is not in models.json`);
    process.exit(2);
  }
  return lane;
}

function scrapeMetrics(container) {
  if (!container) return null;
  try {
    const text = execFileSync("docker", ["exec", container, "curl", "-s", "--max-time", "10", "localhost:8000/metrics"], { encoding: "utf8", timeout: 20000 });
    const totals = {};
    for (const line of text.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([-+0-9.eE]+|NaN)$/.exec(line.trim());
      if (!match) continue;
      totals[match[1]] = (totals[match[1]] ?? 0) + Number(match[3]);
    }
    return totals;
  } catch {
    return null;
  }
}

function metricsDelta(before, after) {
  if (!before || !after) return null;
  const d = (name) => (after[name] ?? 0) - (before[name] ?? 0);
  const drafts = d("vllm:spec_decode_num_drafts_total");
  const draftTokens = d("vllm:spec_decode_num_draft_tokens_total");
  const accepted = d("vllm:spec_decode_num_accepted_tokens_total");
  const out = {
    preemptions: d("vllm:num_preemptions_total"),
    promptTokens: d("vllm:prompt_tokens_total"),
    generationTokens: d("vllm:generation_tokens_total"),
  };
  if (drafts > 0) {
    out.specAcceptanceRate = round(accepted / draftTokens, 3);
    out.specMeanAcceptedLength = round(1 + accepted / drafts, 2);
  }
  if (!("vllm:generation_tokens_total" in after)) out.note = "engine stats not exposed (e.g. --disable-log-stats)";
  return out;
}

async function ensureAwake(config, lane) {
  const body = buildBody(config, lane, { messages: [{ role: "user", content: "ok" }], max_tokens: 1 });
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const res = await request({ ...config, requestTimeoutMs: 3600 * 1000 }, "/v1/chat/completions", body);
    if (res.status === 200) return true;
    console.error(`wake attempt ${attempt}: ${res.status} ${errorText(res)}`);
    await new Promise((r) => setTimeout(r, 30000));
  }
  return false;
}

async function runSpeed(config, lane, filler) {
  const prompts = speedPrompts(filler);
  const runs = [];
  for (let r = 0; r < config.speedRepeats; r += 1) {
    for (const prompt of prompts) {
      const run = await timedStream(config, buildBody(config, lane, { messages: prompt.messages, max_tokens: config.speedMaxTokens }));
      runs.push({ category: prompt.category, ...run });
      console.error(`  speed ${prompt.category}: ${run.status} ${round(run.decodeTps)} tok/s, ttft ${round(run.ttftMs, 0)} ms, ${run.completionTokens} tok`);
    }
  }
  const ok = runs.filter((r) => r.status === 200);
  const byCategory = {};
  for (const run of ok) (byCategory[run.category] ??= []).push(run.decodeTps);
  return {
    medianDecodeTps: round(median(ok.map((r) => r.decodeTps))),
    medianTtftMs: round(median(ok.map((r) => r.ttftMs)), 0),
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, round(median(v))])),
    errors: runs.length - ok.length,
    runs,
  };
}

async function runPrefill(config, lane, filler) {
  const out = [];
  for (const target of config.prefillSizes) {
    const chars = Math.max(400, Math.floor((target / BUNDLE_TOKENS_PER_COPY) * filler.length));
    const text = filler.repeat(Math.ceil(chars / filler.length)).slice(0, chars);
    const body = buildBody(config, lane, { messages: [{ role: "user", content: `Ref ${randomBytes(8).toString("hex")}.\n\n${text}\n\nReply with ok.` }], max_tokens: 1 });
    const res = await request(config, "/v1/chat/completions", body);
    const promptTokens = res.json?.usage?.prompt_tokens ?? null;
    const seconds = res.elapsedMs / 1000;
    const row = { target, status: res.status, promptTokens, seconds: round(seconds, 2), prefillTps: promptTokens ? round(promptTokens / seconds, 0) : null };
    if (res.status !== 200) row.error = errorText(res);
    out.push(row);
    console.error(`  prefill ${target}: ${res.status} ${promptTokens} tok in ${round(seconds, 1)} s`);
  }
  return out;
}

async function runThroughput(config, lane, filler) {
  const prompts = speedPrompts(filler);
  const levels = [];
  for (const concurrency of config.throughputLevels) {
    const runs = [];
    const t0 = performance.now();
    await Promise.all(Array.from({ length: concurrency }, async (_, worker) => {
      for (let i = 0; i < config.throughputPerWorker; i += 1) {
        const prompt = prompts[(worker + i * concurrency) % prompts.length];
        runs.push(await timedStream(config, buildBody(config, lane, { messages: prompt.messages, max_tokens: config.speedMaxTokens })));
      }
    }));
    const wallSeconds = (performance.now() - t0) / 1000;
    const ok = runs.filter((r) => r.status === 200);
    const level = {
      concurrency,
      requests: runs.length,
      errors: runs.length - ok.length,
      wallSeconds: round(wallSeconds, 1),
      aggregateTps: round(sum(ok.map((r) => r.completionTokens)) / wallSeconds),
      perStreamMedianTps: round(median(ok.map((r) => r.decodeTps))),
      ttftMedianMs: round(median(ok.map((r) => r.ttftMs)), 0),
    };
    levels.push(level);
    console.error(`  throughput c=${concurrency}: ${level.aggregateTps} tok/s aggregate, ${level.perStreamMedianTps} per stream, ${level.errors} errors`);
  }
  return levels;
}

async function runQuality(config, lane) {
  const all = buildQualityCases({
    quick: config.quick,
    multimodal: lane.multimodal === true,
    tools: (lane.toolSupport ?? "none") !== "none",
    fillerPath: FILLER_PATH,
  });
  // A case longer than the lane's context cannot run there; leave it out rather than fail it.
  const fits = (c) => !c.promptTokens || !lane.maxModelLen || c.promptTokens + 8192 <= lane.maxModelLen;
  const cases = all.filter(fits);
  const skipped = all.filter((c) => !fits(c)).map((c) => c.id);
  if (skipped.length) console.error(`  quality: skipping ${skipped.join(", ")} (longer than maxModelLen ${lane.maxModelLen})`);
  const results = [];
  let next = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: Math.max(1, config.qualityConcurrency) }, async () => {
    while (next < cases.length) {
      const item = cases[next];
      next += 1;
      const res = await request(config, "/v1/chat/completions", buildBody(config, lane, item.request));
      const choice = res.json?.choices?.[0];
      const message = choice?.message ?? {};
      const reasoning = message.reasoning ?? message.reasoning_content ?? "";
      const row = {
        id: item.id,
        category: item.category,
        status: res.status,
        seconds: round(res.elapsedMs / 1000, 1),
        finish: choice?.finish_reason ?? null,
        promptTokens: res.json?.usage?.prompt_tokens ?? null,
        completionTokens: res.json?.usage?.completion_tokens ?? null,
      };
      if (res.status !== 200) {
        Object.assign(row, { pass: false, detail: `HTTP ${res.status}: ${String(errorText(res)).slice(0, 160)}` });
      } else {
        const grade = await item.grade({ message, content: message.content ?? "", reasoning });
        Object.assign(row, grade);
        if (item.id === "tools-injection-system" && String(reasoning).includes("7431")) row.reasoningLeak = true;
      }
      results.push(row);
      console.error(`  quality ${row.id}: ${row.pass ? "pass" : `FAIL ${row.detail ?? ""}`} (${row.seconds}s, ${row.finish})`);
    }
  }));
  const wallSeconds = (performance.now() - t0) / 1000;
  const categories = {};
  for (const row of results) {
    const c = (categories[row.category] ??= { n: 0, pass: 0, truncated: 0, errors: 0 });
    c.n += 1;
    if (row.pass) c.pass += 1;
    if (row.finish === "length") c.truncated += 1;
    if (row.status !== 200) c.errors += 1;
  }
  for (const c of Object.values(categories)) c.rate = round(c.pass / c.n, 3);
  return {
    concurrency: config.qualityConcurrency,
    cases: results.length,
    passRate: round(results.filter((r) => r.pass).length / results.length, 3),
    skipped,
    errors: results.filter((r) => r.status !== 200).length,
    truncated: results.filter((r) => r.finish === "length").length,
    reasoningLeaks: results.filter((r) => r.reasoningLeak).length,
    wallSeconds: round(wallSeconds, 0),
    aggregateTps: round(sum(results.map((r) => r.completionTokens)) / wallSeconds),
    categories,
    results: results.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  if (config.selfTest) {
    const failures = await selfTest({ fillerPath: FILLER_PATH, withSandbox: config.withSandbox });
    if (failures.length) {
      console.error(`self-test FAILED:\n  ${failures.join("\n  ")}`);
      process.exit(1);
    }
    console.log("self-test OK");
    return;
  }
  const lane = readLane(config.model);
  const filler = readFileSync(FILLER_PATH, "utf8");
  const report = {
    model: config.model,
    label: config.label,
    startedAt: new Date().toISOString(),
    settings: {
      sampling: config.sampling, thinking: config.thinking, reasoningEffort: config.reasoningEffort, quick: config.quick,
      qualityConcurrency: config.qualityConcurrency, speedMaxTokens: config.speedMaxTokens,
    },
    suites: {},
  };
  console.error(`waking ${config.model} ...`);
  if (!(await ensureAwake(config, lane))) {
    console.error("lane did not answer; aborting");
    process.exit(1);
  }
  const runners = { speed: runSpeed, prefill: runPrefill, throughput: runThroughput, quality: runQuality };
  for (const suite of config.suites) {
    if (!runners[suite]) {
      console.error(`unknown suite '${suite}'`);
      process.exit(2);
    }
    console.error(`${suite} ...`);
    const before = scrapeMetrics(lane.container);
    const data = await runners[suite](config, lane, filler);
    report.suites[suite] = { data, metrics: metricsDelta(before, scrapeMetrics(lane.container)) };
  }
  report.finishedAt = new Date().toISOString();
  const out = config.out ?? join(REPO_DIR, "tmp", "bench", `${config.model}-${config.label ?? "run"}-${report.startedAt.replace(/[:.]/g, "-")}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  const s = report.suites;
  const lines = [`${config.model}${config.label ? ` [${config.label}]` : ""}`];
  if (s.speed) lines.push(`speed: median ${s.speed.data.medianDecodeTps} tok/s, ttft ${s.speed.data.medianTtftMs} ms, by category ${JSON.stringify(s.speed.data.byCategory)}`);
  if (s.prefill) lines.push(`prefill: ${s.prefill.data.map((r) => `${r.promptTokens ?? r.target} tok ${r.seconds}s (${r.prefillTps} tok/s)`).join("; ")}`);
  if (s.throughput) lines.push(`throughput: ${s.throughput.data.map((l) => `c${l.concurrency} ${l.aggregateTps} agg/${l.perStreamMedianTps} per`).join("; ")}`);
  if (s.quality) {
    const q = s.quality.data;
    lines.push(`quality @c${q.concurrency}: ${q.passRate} (${q.cases} cases, ${q.errors} errors, ${q.truncated} truncated, ${q.reasoningLeaks} reasoning leaks) ${Object.entries(q.categories).map(([k, v]) => `${k} ${v.pass}/${v.n}`).join(", ")}`);
  }
  for (const [name, suite] of Object.entries(s)) {
    if (suite.metrics?.specMeanAcceptedLength) lines.push(`${name} spec: mean accepted length ${suite.metrics.specMeanAcceptedLength}, acceptance ${suite.metrics.specAcceptanceRate}, preemptions ${suite.metrics.preemptions}`);
  }
  lines.push(`report: ${out}`);
  console.log(lines.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
