from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace

from vllm.tokenizers import get_tokenizer
from vllm.tool_parsers import ToolParserManager
from vllm.tool_parsers.mistral_tool_parser import MistralToolParser


PLUGIN_PATH = Path(__file__).with_name("dolphin_mistral_tool_parser.py")
MODEL_SNAPSHOT = os.environ["DOLPHIN_MODEL_SNAPSHOT"]


def load_plugin() -> None:
    if "dolphin_mistral" in ToolParserManager.list_registered():
        return

    spec = importlib.util.spec_from_file_location(
        "dolphin_mistral_tool_parser",
        PLUGIN_PATH,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


def main() -> None:
    load_plugin()

    tokenizer = get_tokenizer(MODEL_SNAPSHOT, tokenizer_mode="hf")
    request = SimpleNamespace(tools=[{"type": "function"}], tool_choice="auto")

    base_parser = MistralToolParser(tokenizer)
    plugin_parser_cls = ToolParserManager.get_tool_parser("dolphin_mistral")
    plugin_parser = plugin_parser_cls(tokenizer)

    raw_tool_output = '[{"name":"get_weather","arguments":{"city":"Paris"}}]'

    base_result = base_parser.extract_tool_calls(raw_tool_output, request)
    assert not base_result.tools_called
    assert base_result.content == raw_tool_output

    plugin_result = plugin_parser.extract_tool_calls(raw_tool_output, request)
    assert plugin_result.tools_called
    assert plugin_result.content is None
    assert len(plugin_result.tool_calls) == 1

    tool_call = plugin_result.tool_calls[0]
    assert tool_call.function is not None
    assert tool_call.function.name == "get_weather"
    assert json.loads(tool_call.function.arguments) == {"city": "Paris"}

    raw_tool_output_with_tokenizer_space = (
        '[{"name":"get_weather","arguments":{"city":Ġ"Paris"}}]'
    )
    sanitized_result = plugin_parser.extract_tool_calls(
        raw_tool_output_with_tokenizer_space,
        request,
    )
    assert sanitized_result.tools_called
    assert sanitized_result.content is None
    assert len(sanitized_result.tool_calls) == 1
    assert json.loads(sanitized_result.tool_calls[0].function.arguments) == {
        "city": "Paris"
    }

    plain_result = plugin_parser.extract_tool_calls("hello", request)
    assert not plain_result.tools_called
    assert plain_result.content == "hello"


if __name__ == "__main__":
    main()
