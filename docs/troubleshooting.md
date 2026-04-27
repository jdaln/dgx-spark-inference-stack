# Troubleshooting & Monitoring

Use [tools/README.md](../tools/README.md) for the maintained probe and validation commands. This page focuses on failure modes and what the outputs mean.

## Monitoring and Debugging

### Check waker state
```bash
curl http://localhost:8009/debug/state | jq
```

Returns:
- Current configuration
- Running models
- Start times and last-seen timestamps
- Idle/uptime information

### Check GPU memory statistics
```bash
# All models
curl http://localhost:8009/debug/gpu-stats | jq

# Specific model
curl http://localhost:8009/debug/gpu-stats/vllm-gpt-oss-120b | jq
```

Returns per model:
- Sessions count
- Total runtime
- Min/mean/max GPU memory usage (MB)
- Last used timestamp

### View logs
> [!NOTE]
> By default, Docker logging uses `json-file` with rotation (10MB, 3 files) and vLLM request/stats logging is suppressed. Waker verbose logging is off by default. You can disable all Docker logging by setting `DOCKER_LOG_DRIVER=none`.

### Check container status
```bash
docker compose ps
```

### Default State of logging
- **Docker Logging:** Enabled (`json-file`) with rotation (10MB, 3 files).
- **vLLM Logging:** Request and usage statistics logging is disabled.
- **Nginx Logging:** Logs are redirected to stdout/stderr and captured by Docker, but contain no sensitive request data.
- **Waker Logging:** Verbose logging is disabled.

### Controlling Logs
You can toggle logging levels using environment variables when starting the stack:

```bash
# Disable ALL logs (Strict No-Log)
DOCKER_LOG_DRIVER=none docker compose up -d

# Enable verbose debugging
VLLM_LOGGING=1 WAKER_VERBOSE=1 docker compose up -d
```

**Variables:**
- `DOCKER_LOG_DRIVER`: Set to `none` to disable all Docker logging. (Default: `json-file`)
- `VLLM_LOGGING`: Set to `1` to enable vLLM internal logging. (Default: `0`)
- `WAKER_VERBOSE`: Set to `1` to enable verbose waker logs. (Default: `0`)

**Example: View logs for a specific model**
```bash
docker logs -f vllm-qwen-math
```

## Error Responses

### HTTP 429 - Model Unavailable

When a model is busy (another model is currently loaded), you'll receive a detailed response:

```json
{
  "ok": false,
  "error": "busy",
  "requested": "qwen-math",
  "currentModel": {
    "name": "vllm-gpt-oss-20b",
    "uptimeSec": 245,
    "idleSec": 120,
    "timeUntilReleaseSec": 180,
    "willAutoStop": true
  },
  "retryAfterSec": 180
}
```

**Fields:**
- `requested`: The model you tried to access
- `currentModel.name`: The model currently loaded in GPU memory
- `currentModel.uptimeSec`: How long the current model has been running
- `currentModel.idleSec`: How long since the current model was last used
- `currentModel.timeUntilReleaseSec`: Estimated seconds until the model may be released (if idle)
- `currentModel.willAutoStop`: Whether the model will auto-stop when idle (true if past minimum uptime)
- `retryAfterSec`: Recommended retry delay (also in `Retry-After` header)

**What to do:**
- Wait for `timeUntilReleaseSec` seconds if the model is idle and will auto-stop
- Use `retryAfterSec` as a safe retry delay
- If `idleSec` is low, the model is actively being used - retry later

### Common Issues

#### Model won't start
- Check GPU availability: `nvidia-smi`
- Check disk space for model downloads
- View container logs: `docker compose logs vllm-<model-name>`
- Verify HuggingFace access for model downloads

#### Always getting HTTP 429 (Busy)
- Check the error response - it shows which model is loaded and when it will be released
- Look at `idleSec` and `timeUntilReleaseSec` in the response
- If `willAutoStop` is `true`, the model will release after `timeUntilReleaseSec`
- If `willAutoStop` is `false`, the model hasn't reached minimum uptime yet
- Check waker state for more details: `curl http://localhost:8009/debug/state`
- To force immediate switch: `docker compose stop vllm-gpt-oss-20b` (or other model)

#### Health check timeout
- Increase `HEALTH_TIMEOUT_MS` (default: 900000 = 15 min) if the normal gateway path is timing out while waker waits on `/ensure/<model>`
- Check model container logs for errors
- Verify GPU memory is sufficient

#### Long first cold start stays unhealthy
- Distinguish the two startup gates: `HEALTH_TIMEOUT_MS` controls the waker `/ensure` path, while `tools/run-model.sh` waits on the model container's own Docker healthcheck
- For very large first downloads or first loads, increase the model service `healthcheck.start_period` in its compose fragment; otherwise Docker can mark the container unhealthy before the initial load finishes
- A practical example is the experimental Huihui GPT-OSS 120B variant, whose cold start needed a much longer health grace than the default 30 minutes
- If the model directory under `./models/` is still growing or contains large `.incomplete` blobs, the startup may still be doing valid work rather than hanging

#### Host RAM pressure during compile or graph capture
- On DGX Spark, large-model startup failures can come from shared system RAM pressure during download extraction, JIT compilation, or CUDA graph capture, even when the GPU-facing flags look reasonable
- For large TF5 models such as Gemma, a persistent `/swap.img` can be a reasonable host-level mitigation when the goal is to keep the faster runtime path rather than forcing `--enforce-eager` or permanently shrinking the normal runtime envelope
- If the service still dies on the first real request with `ray.exceptions.OutOfMemoryError` at roughly the default `0.95` node threshold, raise the Gemma service's `RAY_memory_usage_threshold` instead of immediately downgrading the runtime path. In this repo, the Gemma services now default that threshold to `0.99` for exactly that reason
- For sawpping, if `/etc/fstab` does not already  contain `/swap.img none swap sw 0 0` or it is not working, the  setup is:

```bash
# Bring up the persistent swap file already listed in /etc/fstab.
sudo chmod 600 /swap.img
sudo mkswap /swap.img
sudo swapon -a
swapon --show
free -h

# Keep swap as a startup pressure valve, not a steady-state working set.
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf
cat /proc/sys/vm/swappiness

# If /swap.img is missing or invalid, rebuild it once and re-enable it.
sudo swapoff /swap.img 2>/dev/null || true
sudo rm -f /swap.img
sudo fallocate -l 240G /swap.img
sudo chmod 600 /swap.img
sudo mkswap /swap.img
sudo swapon -a

```


- Treat swap as startup headroom, not as a throughput optimization. If swap stays heavily used after the model reaches health, the runtime envelope is still too aggressive for the host

#### Gemma TF5 startup dies with AOTAutograd `PicklingError`
- A Gemma TF5 cold start can fail during standalone compile with a trace ending in `Can't pickle <function launcher ...>: attribute lookup launcher on __main__ failed`
- On the current TF5 image, the practical repo-level workaround is to disable local AOTAutograd cache saves for the affected service with `TORCHINDUCTOR_AUTOGRAD_CACHE=0`
- This is distinct from the earlier Ray host-memory path: if the container exits with that `PicklingError`, adding more swap is not the relevant fix

#### Models keep stopping
- Increase `IDLE_STOP_SECONDS` or set to 0 to disable auto-stop
- Use `/touch/<model>` endpoint to keep model alive
- Check `NO_STOP_BEFORE_SECONDS` isn't too low
- For long cold starts, also verify you are on the updated waker logic: containers that have never reached `healthy` once are now protected from idle reaping even if Docker health has already flipped from `starting` to `unhealthy`

#### "Model does not exist" error
- Ensure model name in API request matches `--served-model-name` in the model's compose file
- Verify the model is listed in `models.json`
- If the model was added recently, run `bash tools/reload-control-plane.sh` so `waker` and `request-validator` reload `models.json`
- If you changed which model is marked `lifecycle: "utility"`, use `bash tools/reload-control-plane.sh --stop-stale-utility` to also stop the old helper if it is still running

#### Tool calls show up in `content` or `reasoning` instead of `tool_calls`
- First confirm the behavior with a non-streaming probe before blaming the client transport:

```bash
python3 tools/test-model.py --model <model-id> --tool-call
```

- If the response contains raw `<tool_call>...</tool_call>` text in `message.content` or `message.reasoning` while `message.tool_calls` is empty, the model's emitted format does not match the configured parser.
- In this repo, general instruct-family models that emit Hermes-style `<tool_call>` blocks, including the Qwen3-Next variants in `compose/models-experimental.yml`, should use `--tool-call-parser hermes`.
- Reserve `qwen3_coder` or `qwen3_xml` for the Qwen coder / distilled families that actually emit those formats. The current compose files already split those cases that way.
- If the payload is being captured inside `reasoning`, also verify that the configured `--reasoning-parser` is appropriate for that checkpoint before changing client code.
- After changing parser flags, rerun `bash tools/validate-stack.sh` and a non-streaming tool-call probe before testing streaming clients again.

#### Streaming client breaks while non-streaming works
- Some clients are stricter about SSE delta shape for tool calls than the plain non-streaming OpenAI response.
- First compare against a non-streaming probe. If non-streaming works and only streaming breaks, the problem may be client-side SSE/tool-call expectations rather than the model output itself.
- The repo keeps an optional compatibility shim in `tools/streaming-proxy/` that converts a successful non-streaming tool-call response back into SSE.

```bash
docker build -t vllm-streaming-proxy -f tools/streaming-proxy/Dockerfile tools/streaming-proxy

docker run --rm -p 9000:9000 \
  --add-host host.docker.internal:host-gateway \
  -e UPSTREAM_BASE=http://host.docker.internal:8009/v1 \
  vllm-streaming-proxy
```

- Then point the affected client at `http://localhost:9000/v1` instead of the normal gateway.
