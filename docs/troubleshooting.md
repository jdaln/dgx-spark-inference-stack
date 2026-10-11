# Troubleshooting

Common failures and what to do. Error codes: [error-contract.md](error-contract.md).
Scripts: [tools/README.md](../tools/README.md).

## Inspecting the stack

```bash
# What the waker sees: running models, idle and uptime counters
curl -s http://localhost:8009/debug/state | jq

# Memory use per model: sessions, min/mean/max MB, last use
curl -s http://localhost:8009/debug/gpu-stats | jq
curl -s http://localhost:8009/debug/gpu-stats/vllm-oss120b | jq

docker compose ps
docker logs -f vllm-oss20b
```

Logs rotate at 10 MB, 3 files. vLLM request and stats logging is off. nginx does not log
request bodies.

```bash
DOCKER_LOG_DRIVER=none docker compose up -d          # no logs
VLLM_LOGGING=1 WAKER_VERBOSE=1 docker compose up -d  # verbose
```

## HTTP 429: another model holds the GPU

```json
{
  "error": {
    "message": "Model 'gemma4-26b-a4b' cannot start because 'gpt-oss-20b' is already running. Expected to auto-stop in ~180s.",
    "type": "rate_limit_error",
    "param": "model",
    "code": "model_busy"
  }
}
```

The headers say what holds the GPU and when it frees up:

| Header | Meaning |
|---|---|
| `Retry-After` | Seconds to wait before retrying. |
| `X-DGX-Busy-Container`, `X-DGX-Busy-Model` | What holds the GPU. |
| `X-Model-Uptime-Sec`, `X-Model-Idle-Sec` | How long it has run, and been idle. |
| `X-Time-Until-Release-Sec` | Estimated seconds until idle stop. |
| `X-Model-Will-Auto-Stop` | `false` if idle stop is disabled. |

Wait, or stop the running model: `docker stop vllm-oss20b`. Code `external_gpu_busy` means
an external workload such as ComfyUI holds the GPU: see
[comfyui-coexistence.md](comfyui-coexistence.md).

## A model does not start

Check `nvidia-smi`, free disk and the container logs (`docker logs vllm-<name>`).

- `model_weights_missing`, or offline-mode errors about files under `/models`: run
  `bash tools/download-weights.sh <model-id>`.
- `Operation not permitted` (`EPERM`): seccomp blocks a syscall. See
  [security.md](security.md#a-lane-fails-with-operation-not-permitted).
- `Permission denied` under `/root/.cache`: the lane's cache directory is owned by your
  user. Run `sudo chown -R root:root cache/<lane>`.

## Cold start times out

Two timeouts apply:

- `HEALTH_TIMEOUT_MS` on the waker (15 minutes) limits normal requests.
- The model's Docker `healthcheck.start_period` in its compose fragment limits
  `tools/run-model.sh`. `HEALTH_TIMEOUT_MS` does not change it.

A first load of a large model can need more than the 1800 s most lanes set.

## Host RAM pressure during startup

GPU and system RAM are one pool on DGX Spark. Large models can fail during weight loading,
JIT compilation or CUDA graph capture even when the GPU flags look fine. Persistent swap
gives startup the headroom without falling back to `--enforce-eager`:

```bash
# Enable the swap file listed in /etc/fstab (/swap.img none swap sw 0 0)
sudo chmod 600 /swap.img
sudo mkswap /swap.img
sudo swapon -a
swapon --show

# Use swap for startup peaks only
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf

# If /swap.img is missing or invalid, recreate it
sudo swapoff /swap.img 2>/dev/null || true
sudo rm -f /swap.img
sudo fallocate -l 240G /swap.img
sudo chmod 600 /swap.img
sudo mkswap /swap.img
sudo swapon -a
```

If swap stays in heavy use after the model is healthy, the lane asks for too much memory.

## Models stop too soon

Raise `IDLE_STOP_SECONDS`, or set it to `0` to turn idle stop off. To keep one model
loaded, see [advanced.md](advanced.md#keeping-a-model-loaded).

## "Model does not exist"

The `model` in the request must match `--served-model-name` in compose and the key in
`models.json`. After editing `models.json`, run `bash tools/reload-control-plane.sh`.

## Tool calls arrive as text

Run `bash tools/test-lane.sh <model-id>` and read the response bodies in
`tmp/test-lane/<model-id>/`.

- Raw `<tool_call>...</tool_call>` in `message.content` with empty `message.tool_calls`:
  the tool parser does not match the model's output format. Hermes-style models use
  `--tool-call-parser hermes`. `qwen3_coder` and `qwen3_xml` are for the Qwen families that
  emit those formats.
- The call is in `reasoning`: check `--reasoning-parser` for that checkpoint.

Run `bash tools/validate-stack.sh` and `test-lane.sh` again after a parser change.

## Streaming breaks a client, non-streaming works

Some clients are strict about the shape of streamed tool-call deltas.
`tools/streaming-proxy/` turns a non-streaming tool-call response into SSE. Run it and point
the client at `http://localhost:9000/v1`. See [tools/README.md](../tools/README.md#manual-probes).
