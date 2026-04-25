# proxy.py - Streaming-to-non-streaming proxy for vLLM tool calls
# Fixes vLLM streaming tool-call parsing bugs that break strict SSE clients.
import json
import os
import time
from typing import Any, Dict

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

UPSTREAM_BASE = os.environ.get("UPSTREAM_BASE", "http://localhost:8000/v1").rstrip("/")

app = FastAPI(title="vLLM Streaming Fix Proxy")


def _ensure_tool_call_shape(message: Dict[str, Any]) -> None:
    """Normalize tool_calls to what strict clients expect."""
    tool_calls = message.get("tool_calls")
    if not tool_calls:
        return
    for index, tool_call in enumerate(tool_calls):
        tool_call.setdefault("index", index)
        tool_call.setdefault("type", "function")
        function = tool_call.get("function") or {}
        arguments = function.get("arguments")
        if isinstance(arguments, dict):
            function["arguments"] = json.dumps(arguments)
        elif arguments is None:
            function["arguments"] = ""
        tool_call["function"] = function


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/v1/models")
async def list_models(request: Request):
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{UPSTREAM_BASE}/models",
            headers={"Authorization": request.headers.get("authorization", "Bearer EMPTY")},
        )
        return JSONResponse(content=response.json(), status_code=response.status_code)


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    wants_stream = bool(body.get("stream", False))
    has_tools = bool(body.get("tools"))

    if not has_tools or not wants_stream:
        async with httpx.AsyncClient(timeout=None) as client:
            if wants_stream:

                async def stream_response():
                    async with client.stream(
                        "POST",
                        f"{UPSTREAM_BASE}/chat/completions",
                        json=body,
                        headers={
                            "Authorization": request.headers.get("authorization", "Bearer EMPTY"),
                            "Content-Type": "application/json",
                        },
                    ) as response:
                        async for chunk in response.aiter_bytes():
                            yield chunk

                return StreamingResponse(stream_response(), media_type="text/event-stream")

            response = await client.post(
                f"{UPSTREAM_BASE}/chat/completions",
                json=body,
                headers={
                    "Authorization": request.headers.get("authorization", "Bearer EMPTY"),
                    "Content-Type": "application/json",
                },
            )
            return JSONResponse(content=response.json(), status_code=response.status_code)

    upstream_body = dict(body)
    upstream_body["stream"] = False

    async with httpx.AsyncClient(timeout=None) as client:
        response = await client.post(
            f"{UPSTREAM_BASE}/chat/completions",
            json=upstream_body,
            headers={
                "Authorization": request.headers.get("authorization", "Bearer EMPTY"),
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()
        completion = response.json()

    completion_id = completion.get("id", "chatcmpl-proxy")
    created = completion.get("created", int(time.time()))
    model = completion.get("model", body.get("model", "unknown"))
    choice0 = (completion.get("choices") or [{}])[0]
    message = choice0.get("message") or {}
    _ensure_tool_call_shape(message)

    finish_reason = choice0.get("finish_reason")

    def sse():
        role_chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}],
        }
        yield f"data: {json.dumps(role_chunk)}\n\n"

        delta: Dict[str, Any] = {}
        if message.get("tool_calls"):
            delta["tool_calls"] = message["tool_calls"]
            delta["content"] = ""
        else:
            delta["content"] = message.get("content") or ""

        payload_chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
        }
        yield f"data: {json.dumps(payload_chunk)}\n\n"

        finish_chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [{"index": 0, "delta": {}, "finish_reason": finish_reason}],
        }
        yield f"data: {json.dumps(finish_chunk)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=9000)
