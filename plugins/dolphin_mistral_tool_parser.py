from __future__ import annotations

import json
from typing import Any

from vllm.entrypoints.openai.protocol import (
    ExtractedToolCallInformation,
    FunctionCall,
)
from vllm.tool_parsers import ToolParserManager
from vllm.tool_parsers.mistral_tool_parser import (
    MistralToolCall,
    MistralToolParser,
)


def _sanitize_tokenizer_whitespace_artifacts(content: str) -> str:
    return content.replace("Ġ", " ").replace("Ċ", "\n")


def _normalize_raw_tool_calls(raw_tool_calls: Any) -> list[dict[str, str]] | None:
    if isinstance(raw_tool_calls, dict):
        raw_tool_calls = [raw_tool_calls]

    if not isinstance(raw_tool_calls, list) or not raw_tool_calls:
        return None

    normalized_tool_calls: list[dict[str, str]] = []
    for raw_tool_call in raw_tool_calls:
        if not isinstance(raw_tool_call, dict):
            return None

        name = raw_tool_call.get("name")
        arguments = raw_tool_call.get("arguments", {})
        if not isinstance(name, str) or not name:
            return None

        if isinstance(arguments, str):
            normalized_arguments = arguments
        else:
            try:
                normalized_arguments = json.dumps(arguments, ensure_ascii=False)
            except TypeError:
                return None

        normalized_tool_calls.append(
            {"name": name, "arguments": normalized_arguments}
        )

    return normalized_tool_calls


@ToolParserManager.register_module("dolphin_mistral")
class DolphinMistralToolParser(MistralToolParser):
    """Fallback parser for Dolphin's raw JSON tool output on the HF path."""

    def extract_tool_calls(self, model_output, request):
        extracted = super().extract_tool_calls(model_output, request)
        if extracted.tools_called:
            return extracted

        tools = getattr(request, "tools", None)
        content = extracted.content.strip() if extracted.content else ""
        if not tools or not content or content[0] not in "[{":
            return extracted

        try:
            decoded_tool_calls = json.loads(content)
        except json.JSONDecodeError:
            sanitized_content = _sanitize_tokenizer_whitespace_artifacts(content)
            if sanitized_content == content:
                return extracted

            try:
                decoded_tool_calls = json.loads(sanitized_content)
            except json.JSONDecodeError:
                return extracted

        normalized_tool_calls = _normalize_raw_tool_calls(decoded_tool_calls)
        if normalized_tool_calls is None:
            return extracted

        tool_calls = [
            MistralToolCall(
                type="function",
                function=FunctionCall(
                    name=tool_call["name"],
                    arguments=tool_call["arguments"],
                ),
            )
            for tool_call in normalized_tool_calls
        ]

        return ExtractedToolCallInformation(
            tools_called=True,
            tool_calls=tool_calls,
            content=None,
        )
