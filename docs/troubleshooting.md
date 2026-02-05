# Troubleshooting & Monitoring

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
> The stack implements a **No-Log Policy**. Docker logging is disabled for all services (`logging: driver: none`), and vLLM request/stats logging is suppressed. Standard `docker logs` commands will sometimes return no output.

To debug the waker service specifically, you can temporarily re-enable logging in `docker-compose.yml` or use the debug endpoints.

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

### HTTP 403 - Model Unavailable

When a model is busy (another model is currently loaded), you'll receive a detailed response:

```json
{
  "error": "model-unavailable",
  "requested": "qwen-math",
  "reason": "Another model is currently loaded",
  "current_model": "vllm-gpt-oss-20b",
  "uptime_sec": 245,
  "idle_sec": 120,
  "time_until_release_sec": 180,
  "will_auto_stop": true,
  "retry_after_sec": 180
}
```

**Fields:**
- `requested`: The model you tried to access
- `current_model`: The model currently loaded in GPU memory
- `uptime_sec`: How long the current model has been running
- `idle_sec`: How long since the current model was last used
- `time_until_release_sec`: Estimated seconds until the model may be released (if idle)
- `will_auto_stop`: Whether the model will auto-stop when idle (true if past minimum uptime)
- `retry_after_sec`: Recommended retry delay (also in `Retry-After` header)

**What to do:**
- Wait for `time_until_release_sec` seconds if the model is idle and will auto-stop
- Use `retry_after_sec` as a safe retry delay
- If `idle_sec` is low, the model is actively being used - retry later

### Common Issues

#### Model won't start
- Check GPU availability: `nvidia-smi`
- Check disk space for model downloads
- View container logs: `docker compose logs vllm-<model-name>`
- Verify HuggingFace access for model downloads

#### Always getting HTTP 403 (Busy)
- Check the error response - it shows which model is loaded and when it will be released
- Look at `idle_sec` and `time_until_release_sec` in the response
- If `will_auto_stop` is `true`, the model will release after `time_until_release_sec`
- If `will_auto_stop` is `false`, the model hasn't reached minimum uptime yet
- Check waker state for more details: `curl http://localhost:8009/debug/state`
- To force immediate switch: `docker compose stop vllm-gpt-oss-20b` (or other model)

#### Health check timeout
- Increase `HEALTH_TIMEOUT_MS` (default 15 min may be too short for large models)
- Check model container logs for errors
- Verify GPU memory is sufficient

#### Models keep stopping
- Increase `IDLE_STOP_SECONDS` or set to 0 to disable auto-stop
- Use `/touch/<model>` endpoint to keep model alive
- Check `NO_STOP_BEFORE_SECONDS` isn't too low

#### "Model does not exist" error
- Ensure model name in API request matches `--served-model-name` in `docker-compose.yml`
- Check that waker's `MODELS_JSON` key matches the route in `gateway.conf`
