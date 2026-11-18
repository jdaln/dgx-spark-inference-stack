# Models

The models the stack serves and the limits that matter in use. The inventory is
[models.json](../models.json); if this page and `models.json` disagree, `models.json` is right.

Model containers run offline. Download a model's weights before its first request:
`bash tools/download-weights.sh <model-id>`.

| Model | Image | Context | Images | Lifecycle | Notes |
|---|---|---:|---|---|---|
| `qwen3.8-27b-nvfp4-dflash2` | DFlash2 | 262144 | yes | | Default. Thinking on. ~30 tok/s. |
| `qwen3.8-flash-next-nvfp4` | B12X | 262144 | yes | exclusive | Hardest questions. ~49 tok/s. |
| `ornith-1.5-122b-nvfp4` | DFlash2 | 262144 | yes | exclusive | Qwen3.5 MoE fine-tune. Thinking on. ~41 tok/s. |
| `glm-5.3-flash-maya-s` | Maya | 131072 | | exclusive | GLM-5.3-Flash, 320B, in 2-bit weights. Not vLLM. ~16 tok/s. |
| `glm-5.3-flash-maya-s-ablated` | Maya | 131072 | | exclusive | The lane above with the model's refusal direction removed. |
| `gemma4-26b-a4b` | B12X | 262144 | yes | | Multilingual. ~76 tok/s. |
| `gemma4-31b` | B12X | 180224 | yes | exclusive | Dense 31B. ~24 tok/s. |
| `gpt-oss-20b` | MXFP4 | 131072 | | | Fast, smaller. |
| `gpt-oss-120b` | MXFP4 | 131072 | | | General chat. |
| `huihui-gpt-oss-120b-mxfp4-abliterated` | MXFP4 | 131072 | | | Abliterated GPT-OSS 120B. |
| `huihui-qwen3.8-27b-abliterated-nvfp4` | DFlash2 | 262144 | yes | | Abliterated Qwen3.8 27B. ~27 tok/s. |
| `huihui-qwen3.8-27b-abliterated` | DFlash2 | 262144 | yes | | BF16 reference for the lane above. Not for serving. |
| `lfm2.5-1.2b` | DFlash2 | 32768 | | utility | Titles, tagging. Stays loaded. |

All models support tool calling except `lfm2.5-1.2b`.

- **Context**: served `max_model_len`. A soaked client ceiling, when lower, is in the
  model's `notes`.
- **exclusive**: takes the GPU alone; the utility helper is stopped while it runs.
- **utility**: stays loaded next to one main model.

## Constraints

### Qwen3.8 models

- Thinking is on by default. `reasoning_effort` takes `low`, `medium` and `xhigh`. The
  validator maps `high` to `xhigh` and `none` to thinking off, and applies `medium` when the
  request sets no effort. Send `high` or `xhigh` for complex tasks.
- The thinking text is in `message.reasoning`, not `message.reasoning_content`.
- Long context with thinking is slow: about 850 s per request at 246k prompt tokens, 2 at a
  time. The gateway timeout is 1200 s, and the margin shrinks with more concurrent requests.
- `min_p` and `logit_bias` are rejected: speculative decoding ignores them.

### `qwen3.8-flash-next-nvfp4`

Reads part of its weights from disk with io_uring. The host must allow io_uring
(`/proc/sys/kernel/io_uring_disabled` = 0), and the container runs a custom seccomp profile.
Create the container from the repo root (`tools/run-model.sh` does). See
[security.md](security.md#seccomp).

### `ornith-1.5-122b-nvfp4`

- Thinking is on by default. `reasoning_effort: "none"` turns it off; any other value keeps
  it on, with no shorter level. The thinking text is in `message.reasoning`.
- Hard problems can think past 12288 tokens. With 8 requests at once, 12288 tokens take
  about 1140 s, near the 1200 s gateway timeout for requests that do not stream.
- `min_p` and `logit_bias` are rejected: speculative decoding ignores them.
- Under load it holds about 96 GiB, leaving about 10 GiB of host memory.

### GLM-5.3-Flash lanes

GLM-5.3-Flash (320B parameters, 18B active) does not fit this host under vLLM. The two lanes
serve [Project Maya](https://github.com/mw00/project-maya)'s Maya-S weights, about 2 bits
per expert weight (97.9% of the FP8 model on the weights' card), on Maya's own engine:
[runtime-baseline.md](runtime-baseline.md#vllm-node-maya). Text only.

- `glm-5.3-flash-maya-s` is the model as published. The refusal direction is not loaded,
  and a request that sends `"ablate": true` gets a 400.
- `glm-5.3-flash-maya-s-ablated` is the same lane with Maya projecting the model's refusal
  direction out of every answer. `"ablate": false` in a request leaves it in for that
  request. See [Abliterated models](#abliterated-models).
- Each takes the GPU alone, like any two main models: while one runs, a request for the
  other gets a 429 until the first has been idle for 20 minutes or is stopped
  (`docker compose --profile models stop vllm-glm-5.3-flash-maya-s`). Loading takes about
  45 s. What serving both ids from one engine would take:
  [vllm-node-maya](../custom-docker-containers/vllm-node-maya/README.md#one-engine-for-both-ids).

Both lanes:

- Four requests run at once; more wait for a slot. One request writes about 16 tok/s, four
  about 29 tok/s in total.
- Prompts are read at about 750 tok/s, and the other running requests pause meanwhile: a
  100K-token prompt holds them for about 140 s.
- `reasoning_effort` takes GLM's own levels as written: `low`, `high` and `max`, and `none`
  for no thinking. `medium` reads as `high`, `xhigh` as `max`. A request that names none
  thinks at `high`. Thinking stops at 32768 tokens. The thinking text is in
  `message.reasoning_content`.
- `max` costs nothing on an easy question (3 s) and about 3,600 tokens, 4 minutes, on a hard
  one when it runs alone. A coding task can think to the cap: one function took 33,500
  tokens and 38 minutes. On the benchmark's quality set at 8 concurrent, `max` passed 83 of
  92 cases and `low` 88 to 89 of the same 92, with a seventh of the tokens. `high` was not
  benchmarked.
- A response that does not stream may take 3600 s on these models, not 1200
  (`requestTimeoutSeconds` in `models.json`), so that a `max` answer can finish.
- At `max`, thinking can use up what the prompt leaves of the 131072-token window: with a
  120K-token prompt it filled the remaining 11K and no answer came. Leave room.
- A lane holds about 98 GiB and leaves about 18 GiB of host memory. Maya ignores cgroup
  limits; `--ram-headroom-gb` is the bound.
- File cache a lane cannot drop makes it keep fewer experts in memory, and answers come
  slower: [troubleshooting.md](troubleshooting.md#glm-reads-long-prompts-slowly).

### Gemma 4 models

- Thinking is off by default. `reasoning_effort: "none"` keeps it off, any other value turns
  it on. `chat_template_kwargs.enable_thinking` overrides both.
- Startup compilation may need host swap: see
  [troubleshooting.md](troubleshooting.md#host-ram-pressure-during-startup).

### Abliterated models

`huihui-qwen3.8-27b-abliterated-nvfp4` is a third-party requant, checked against the BF16
original by behaviour. It sometimes follows instructions injected into tool output and
invents missing tool arguments. Start the BF16 lane by hand only to re-check the requant.

`huihui-gpt-oss-120b-mxfp4-abliterated` returns an empty tool call about 1 time in 5: it
sends its call token without a call. Clients that need a tool call should retry.

`glm-5.3-flash-maya-s-ablated` changes no weights. Maya loads a 17 KB refusal direction from
the weights' own repository and projects it out of the model's activations as it answers.
Its answers were not benchmarked against the plain lane.

## Measuring a limit

The checkpoint card and `max_position_embeddings` do not tell you what this host can
serve. Soak through the gateway:

```bash
node tools/soak-context.mjs --model <model-id> --target-prompt-tokens 240000
```

Record the highest clean tier, the first failing tier and any required request shape in
the lane's `notes`. See [advanced.md](advanced.md#5-soak-it).
