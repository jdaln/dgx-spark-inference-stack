# Debugging Tools

Stuff that helped during debugging. Keep around for next time.

---

## Docker Commands

Clean up stopped containers:
```bash
docker rm $(docker ps -a -q | xargs docker inspect --format '{{if not .State.Running}}{{.Id}}{{end}}')
```

Full rebuild (nuclear option):
```bash
docker compose down && docker compose up -d --build --remove-orphans
```

Check container status:
```bash
docker ps --filter "name=vllm" --format "table {{.Names}}\t{{.Status}}"
```

View logs:
```bash
docker logs vllm-waker --tail 50
docker logs <container> -f  # follow mode
```


---
## Streaming Proxy

`proxy.py` is a FastAPI proxy that converts streaming requests to non-streaming. Useful when vLLM's streaming parser is broken but non-streaming works fine.

### Quick deploy

```bash
docker compose build vllm-proxy
docker compose up -d vllm-proxy
# Then point .opencode.json baseURL to port 9000
```

---

## Model Tester Script

`test_model.py` is a generic tool to verify model behavior, including standard generation and tool calling.

### Usage


```bash
# Standard test (checks for generation and <think> tags)
python3 debugging/test_model.py --model qwen2.5-1.5b-instruct

# Tool calling test (tries to call get_weather)
python3 debugging/test_model.py --model qwen2.5-1.5b-instruct --tool-call

# Custom prompt
python3 debugging/test_model.py --model qwen2.5-1.5b-instruct --prompt "Hello world"
```


---

## Qwen3-Next Tool Calling (Feb 2026)

OpenCode couldn't edit files with qwen3-next-80b. Model was returning tool calls in the wrong field.

### Testing commands

Non-streaming test (shows full response structure):
```bash
curl -s http://localhost:8009/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 63TestTOKEN0REPLACEME" \
  -d '{
    "model": "qwen3-next-80b-a3b-instruct-fp4",
    "stream": false,
    "messages": [{"role":"user","content":"Call the tool get_weather for Zurich"}],
    "tools": [{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}],
    "tool_choice":"auto"
  }' | jq '.choices[0].message'
```

Streaming test:
```bash
curl -N http://localhost:8009/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 63TestTOKEN0REPLACEME" \
  -d '{
    "model": "qwen3-next-80b-a3b-instruct-fp4",
    "stream": true,
    "messages": [{"role":"user","content":"Call the tool get_weather for Zurich"}],
    "tools": [{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}],
    "tool_choice":"auto"
  }'
```

### What was found

First test showed `tool_calls: []` but `reasoning` had the actual call:
```json
{
  "tool_calls": [],
  "reasoning": "<tool_call>\n{\"name\": \"get_weather\", ...}\n</tool_call>"
}
```

Removed `--reasoning-parser deepseek_r1`, then tool call moved to `content`:
```json
{
  "tool_calls": [],
  "content": "<tool_call>\n{\"name\": \"get_weather\", ...}\n</tool_call>"
}
```

Changed parser from `qwen3_coder` to `hermes`, finally worked:
```json
{
  "tool_calls": [{"function": {"name": "get_weather", ...}}],
  "content": null
}
```

### Fix in models-qwen.yml

```yaml
# BEFORE (broken)
- --tool-call-parser
- "qwen3_coder"
- --reasoning-parser
- "deepseek_r1"

# AFTER (works)
- --tool-call-parser
- "hermes"
```

`qwen3_coder` is for Qwen3-Coder models. General instruct models like Qwen3-Next use hermes-style `<tool_call>` format.
