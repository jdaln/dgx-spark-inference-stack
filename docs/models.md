# Models

The models the stack serves and the limits that matter in use. The inventory is
[models.json](../models.json); if this page and `models.json` disagree, `models.json` is right.

Model containers run offline. Download a model's weights before its first request:
`bash tools/download-weights.sh <model-id>`.

| Model | Image | Context | Images | Lifecycle | Notes |
|---|---|---:|---|---|---|
| `qwen3.8-27b-nvfp4-dflash2` | DFlash2 | 262144 | yes | | Default. Thinking on. ~30 tok/s. |
| `qwen3.8-flash-next-nvfp4` | B12X | 262144 | yes | exclusive | Hardest questions. ~49 tok/s. |
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

## Measuring a limit

The checkpoint card and `max_position_embeddings` do not tell you what this host can
serve. Soak through the gateway:

```bash
node tools/soak-context.mjs --model <model-id> --target-prompt-tokens 240000
```

Record the highest clean tier, the first failing tier and any required request shape in
the lane's `notes`. See [advanced.md](advanced.md#5-soak-it).
