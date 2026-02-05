# proxy.py - Streaming-to-non-streaming proxy for vLLM tool calls
# Fixes vLLM streaming tool-call parsing bugs that break OpenCode/Vercel AI SDK
import json
import os
import time
from typing import Any, Dict

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse

UPSTREAM_BASE = os.environ.get("UPSTREAM_BASE", "http://localhost:8000/v1").rstrip("/")

app = FastAPI(title="vLLM Streaming Fix Proxy")


def _ensure_tool_call_shape(msg: Dict[str, Any]) -> None:
    """Normalize tool_calls to what strict clients (AI SDK) expect."""
    tool_calls = msg.get("tool_calls")
    if not tool_calls:
        return
    for i, tc in enumerate(tool_calls):
        tc.setdefault("index", i)
        tc.setdefault("type", "function")
        fn = tc.get("function") or {}
        # OpenAI streaming expects arguments as a string
        args = fn.get("arguments")
        if isinstance(args, dict):
            fn["arguments"] = json.dumps(args)
        elif args is None:
            fn["arguments"] = ""
        tc["function"] = fn


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/v1/models")
async def list_models(req: Request):
    """Proxy models endpoint."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(
            f"{UPSTREAM_BASE}/models",
            headers={"Authorization": req.headers.get("authorization", "Bearer EMPTY")},
        )
        return JSONResponse(content=r.json(), status_code=r.status_code)


@app.post("/v1/chat/completions")
async def chat_completions(req: Request):
    body = await req.json()
    wants_stream = bool(body.get("stream", False))
    has_tools = bool(body.get("tools"))

    # If no tools or not streaming, just proxy through
    if not has_tools or not wants_stream:
        async with httpx.AsyncClient(timeout=None) as client:
            if wants_stream:
                # Stream directly from upstream
                async def stream_response():
                    async with client.stream(
                        "POST",
                        f"{UPSTREAM_BASE}/chat/completions",
                        json=body,
                        headers={
                            "Authorization": req.headers.get("authorization", "Bearer EMPTY"),
                            "Content-Type": "application/json",
                        },
                    ) as response:
                        async for chunk in response.aiter_bytes():
                            yield chunk
                return StreamingResponse(stream_response(), media_type="text/event-stream")
            else:
                r = await client.post(
                    f"{UPSTREAM_BASE}/chat/completions",
                    json=body,
                    headers={
                        "Authorization": req.headers.get("authorization", "Bearer EMPTY"),
                        "Content-Type": "application/json",
                    },
                )
                return JSONResponse(content=r.json(), status_code=r.status_code)

    # For tool calls with streaming: make non-stream request, then re-stream
    upstream_body = dict(body)
    upstream_body["stream"] = False

    async with httpx.AsyncClient(timeout=None) as client:
        r = await client.post(
            f"{UPSTREAM_BASE}/chat/completions",
            json=upstream_body,
            headers={
                "Authorization": req.headers.get("authorization", "Bearer EMPTY"),
                "Content-Type": "application/json",
            },
        )
        r.raise_for_status()
        completion = r.json()

    # Convert non-stream response into a proper SSE stream
    cid = completion.get("id", "chatcmpl-proxy")
    created = completion.get("created", int(time.time()))
    model = completion.get("model", body.get("model", "unknown"))
    choice0 = (completion.get("choices") or [{}])[0]
    msg = choice0.get("message") or {}
    _ensure_tool_call_shape(msg)

    finish_reason = choice0.get("finish_reason")

    def sse():
        # 1) role chunk
        chunk1 = {
            "id": cid,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}],
        }
        yield f"data: {json.dumps(chunk1)}\n\n"

        # 2) content or tool_calls chunk
        delta: Dict[str, Any] = {}
        if msg.get("tool_calls"):
            delta["tool_calls"] = msg["tool_calls"]
            # Many clients expect content to be null/empty during tool calls
            delta["content"] = ""
        else:
            delta["content"] = msg.get("content") or ""

        chunk2 = {
            "id": cid,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
        }
        yield f"data: {json.dumps(chunk2)}\n\n"

        # 3) finish chunk
        chunk3 = {
            "id": cid,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [{"index": 0, "delta": {}, "finish_reason": finish_reason}],
        }
        yield f"data: {json.dumps(chunk3)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9000)
