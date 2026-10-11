---
name: lane-tuning
description: Make a model lane faster or better (serve flags, speculative decoding, engine image, memory, reasoning-effort defaults) with A/B benchmarks, and decide whether a change is safe to adopt. Use when asked to tune or speed up a lane or to compare runtime shapes.
---

# Lane tuning

Adopt a change only if it wins on every suite, quality under concurrent load included.
Benchmark with the GPU otherwise idle: stop other main lanes first.

1. Baseline the committed shape:

   ```bash
   node tools/bench-lane.mjs --model <model-id> --label base
   ```

   Suites: `speed` (single stream), `prefill` (1k/32k/128k), `throughput` (1/2/4/8 streams),
   `quality` (121 graded cases at 8 concurrent requests: math, instructions, tools with
   injection probes, sandboxed code, long context, images). Reports land in `tmp/bench/`.
   `--quick` gives a first look.
2. Start a variant, bench it, restore:

   ```bash
   bash tools/run-variant.sh <model-id> <variant> 'setf("--max-num-seqs"; "16") | delb("--enforce-eager")' ['{"ENV_VAR":"1"}']
   node tools/bench-lane.mjs --model <model-id> --label <variant>
   bash tools/run-variant.sh --restore <model-id>
   ```

   `--image <image>` (before the model id) swaps the engine image. Until restored, the waker
   starts the variant whenever the lane is requested.

   GPU and system RAM are one pool here; a runaway start once took the whole host down. The
   script refuses to start next to another main lane and kills the variant when available
   memory drops under `VARIANT_MIN_FREE_GIB` (10). For an untried engine or kernel path, also
   pass `--mem-limit 100g` and start with a lower `--gpu-memory-utilization`.
3. Read results with care:
   - At temperature 1.0 a single speed run swings by about 30%. Use `--speed-repeats 3`, and
     `--sampling greedy` as a control.
   - On speculative lanes compare acceptance and preemptions in the report. A depth that
     helps one stream can hurt eight; scale it with load (`num_speculative_tokens_per_batch_size`).
   - Quality: compare pass counts per category. Truncations and gateway timeouts under load
     are failures, and long default reasoning is a common cause.
4. Adopt: edit the compose fragment, then rerun the checks from the `model-bring-up` skill,
   steps 3 and 7 to 9: offline checks, `test-lane.sh`, `smoke-errors.sh` with
   `SPEC_MODEL=<model-id>` if the speculative config changed, and the context soak in a
   container. Put the new speeds in `docs/models.md`. Update the lane's `models.json` notes
   only when a limit, required request shape or known failure changed.

Every run leaves a file: bench reports in `tmp/bench/`, soak reports in `tmp/soak/`, test-lane
summaries in `tmp/test-lane/`. Save other output with `2>&1 | tee tmp/checks/<name>.log`.
