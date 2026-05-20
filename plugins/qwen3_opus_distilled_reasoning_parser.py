import json
import re

try:
    from vllm.entrypoints.openai.engine.protocol import DeltaMessage
except ModuleNotFoundError:
    from vllm.entrypoints.openai.protocol import DeltaMessage
from vllm.reasoning.abs_reasoning_parsers import ReasoningParserManager
from vllm.reasoning.qwen3_reasoning_parser import Qwen3ReasoningParser


FALLBACK_PATTERNS = (
    re.compile(r"(?im)^\s*#\s*final\s+answer:\s*(?P<answer>.+?)\s*$"),
    re.compile(r"(?im)^\s*(?:so\s+)?the\s+final\s+answer\s+is\s+(?P<answer>.+?)\s*$"),
    re.compile(r"(?im)^\s*here\s+is\s+the\s+final\s+answer:\s*(?P<answer>.+?)\s*$"),
    re.compile(r"(?im)^\s*(?:therefore,\s*)?(?:the\s+)?answer\s+is\s+(?P<answer>.+?)\s*$"),
    re.compile(r"(?im)^\s*indeed\s+(?P<answer>.+?),\s+which\s+is\b.*$"),
)

STREAM_CONTENT_BUFFER_LIMIT = 256
DIRECT_ANSWER_FILLERS = {
    "indeed",
    "therefore",
    "thus",
    "hence",
    "so",
    "well",
}

ANSWER_WRAPPER_PATTERNS = (
    re.compile(r"(?is)^indeed\s+(?P<answer>.+?),\s+which\s+is\b.*$"),
)

TOOL_CALL_MARKUP_PATTERN = re.compile(
    r"(?is)^(?:<tool_call>\s*.*?</tool_call>\s*)+$"
)

BARE_FUNCTION_TOOL_MARKUP_PATTERN = re.compile(
    r"(?is)^(?:<function=[^>\n]+>\s*.*?</function>\s*)+$"
)

STRUCTURED_VISIBLE_ANSWER_HEADING_PATTERN = re.compile(
    r"(?im)^\s{0,3}(?:#{1,6}\s*|\*{1,2})?(summary|risks|next\s+changes)(?:\*{1,2})?\s*:?\s*$"
)


def normalize_answer(answer):
    value = answer.strip().strip("`*")
    if value.startswith(":"):
        value = value[1:].lstrip()

    lowered = value.lower()
    if lowered.startswith("indeed ") and ", which" in lowered and ", which is" not in lowered:
        return None

    while True:
        unwrapped = None
        for pattern in ANSWER_WRAPPER_PATTERNS:
            match = pattern.match(value)
            if match:
                unwrapped = match.group("answer").strip()
                break
        if unwrapped is None:
            parts = value.split(None, 1)
            if len(parts) == 2 and parts[0].lower().rstrip(",:;") in DIRECT_ANSWER_FILLERS:
                unwrapped = parts[1].lstrip(" ,:;-")
        if unwrapped is None or unwrapped == value:
            break
        value = unwrapped

    if value.lower() in DIRECT_ANSWER_FILLERS:
        return None

    if "\n" not in value and len(value.split()) <= 8:
        value = value.rstrip(" .!?,;:")
    return value or None


def trim_generated_start_token(text):
    prefix, token, suffix = text.partition("<think>")
    return suffix if token else prefix


def append_only_delta(previous_value, current_value):
    if not current_value:
        return None
    if not previous_value:
        return current_value
    if current_value.startswith(previous_value):
        delta = current_value[len(previous_value):]
        return delta or None
    return None


def extract_direct_answer(text):
    if not text:
        return None

    stripped_text = text.strip()
    if not stripped_text or "\n" in stripped_text or any(char in stripped_text for char in ",:;"):
        return None

    answer = normalize_answer(stripped_text)
    if answer is None:
        return None

    lowered = answer.lower()
    if answer.isdigit() or lowered in {"yes", "no", "ok"}:
        return answer

    if lowered in DIRECT_ANSWER_FILLERS:
        return None

    if len(answer.split()) > 2 or len(answer) < 3:
        return None

    return answer


def extract_structured_visible_answer(text):
    if not text:
        return None

    stripped_text = text.strip()
    if not stripped_text:
        return None

    matches = [
        match.group(1).lower().replace("  ", " ")
        for match in STRUCTURED_VISIBLE_ANSWER_HEADING_PATTERN.finditer(stripped_text)
    ]
    if not matches or matches[0] != "summary":
        return None

    unique_matches = set(matches)
    if "summary" not in unique_matches:
        return None

    if not ({"risks", "next changes"} & unique_matches):
        return None

    return stripped_text


def extract_tool_call_payload(text):
    if not text:
        return None

    stripped_text = text.strip()
    if not stripped_text:
        return None

    if TOOL_CALL_MARKUP_PATTERN.fullmatch(stripped_text):
        return stripped_text

    if BARE_FUNCTION_TOOL_MARKUP_PATTERN.fullmatch(stripped_text):
        return stripped_text

    if not stripped_text.startswith("["):
        return None

    try:
        payload = json.loads(stripped_text)
    except json.JSONDecodeError:
        return None

    if not isinstance(payload, list) or not payload:
        return None

    for tool_call in payload:
        if not isinstance(tool_call, dict):
            return None
        if not isinstance(tool_call.get("name"), str) or not tool_call["name"].strip():
            return None
        parameters = tool_call.get("parameters")
        if parameters is not None and not isinstance(parameters, dict):
            return None

    return stripped_text


@ReasoningParserManager.register_module("qwen3_opus_distilled")
class Qwen3OpusDistilledReasoningParser(Qwen3ReasoningParser):
    def __init__(self, tokenizer, *args, **kwargs):
        super().__init__(tokenizer, *args, **kwargs)
        self.buffered_stream_content = ""
        self.stream_passthrough_content = False
        self.stream_answer_emitted = False

    def extract_reasoning(self, model_output, request):
        reasoning_content, final_content = super().extract_reasoning(model_output, request)

        if final_content is not None or reasoning_content is None or not self.thinking_enabled:
            return reasoning_content, final_content

        fallback_reasoning, fallback_content = self.extract_fallback_answer(reasoning_content)
        if fallback_content is None:
            return reasoning_content, final_content

        return fallback_reasoning, fallback_content

    def extract_reasoning_streaming(
        self,
        previous_text,
        current_text,
        delta_text,
        previous_token_ids,
        current_token_ids,
        delta_token_ids,
    ):
        result = super().extract_reasoning_streaming(
            previous_text,
            current_text,
            delta_text,
            previous_token_ids,
            current_token_ids,
            delta_token_ids,
        )

        if not self.thinking_enabled:
            return result

        if self.stream_answer_emitted:
            return None

        if result is not None and result.content is not None:
            return self.handle_streaming_content(previous_text, current_text, result)

        previous_reasoning_text = trim_generated_start_token(previous_text)
        current_reasoning_text = trim_generated_start_token(current_text)

        previous_trimmed_reasoning, previous_content = self.extract_fallback_answer(previous_reasoning_text)
        current_trimmed_reasoning, current_content = self.extract_fallback_answer(current_reasoning_text)

        if current_content is None:
            return result

        reasoning_delta = append_only_delta(previous_trimmed_reasoning, current_trimmed_reasoning)
        content_delta = append_only_delta(previous_content, current_content)

        if reasoning_delta is None and content_delta is None:
            return None

        self.buffered_stream_content = ""
        self.stream_passthrough_content = False
        self.stream_answer_emitted = True

        return DeltaMessage(
            reasoning=reasoning_delta,
            content=content_delta,
        )

    def handle_streaming_content(self, previous_text, current_text, result):
        if result is None or result.content is None:
            return result

        if self.stream_answer_emitted:
            return None

        previous_reasoning, previous_content = self.extract_fallback_answer(
            trim_generated_start_token(previous_text)
        )
        current_reasoning, current_content = self.extract_fallback_answer(
            trim_generated_start_token(current_text)
        )

        if current_content is not None:
            reasoning_delta = append_only_delta(previous_reasoning, current_reasoning)
            content_delta = append_only_delta(previous_content, current_content)
            if reasoning_delta is None and content_delta is None:
                current_content = None
            else:
                self.buffered_stream_content = ""
                self.stream_passthrough_content = False
                self.stream_answer_emitted = True
                return DeltaMessage(
                    reasoning=reasoning_delta,
                    content=content_delta,
                )

        if current_content is None and self.stream_passthrough_content:
            return result

        self.buffered_stream_content += result.content
        _, buffered_content = self.extract_fallback_answer(self.buffered_stream_content)
        if buffered_content is not None:
            self.buffered_stream_content = ""
            self.stream_answer_emitted = True
            return DeltaMessage(content=buffered_content)

        direct_answer = extract_direct_answer(self.buffered_stream_content)
        if direct_answer is not None:
            self.buffered_stream_content = ""
            self.stream_answer_emitted = True
            return DeltaMessage(content=direct_answer)

        if len(self.buffered_stream_content) < STREAM_CONTENT_BUFFER_LIMIT:
            return None

        self.stream_passthrough_content = True
        self.stream_answer_emitted = False
        buffered = self.buffered_stream_content
        self.buffered_stream_content = ""
        return DeltaMessage(content=buffered)

    def extract_fallback_answer(self, reasoning_content):
        best_match = None
        best_answer = None

        for pattern in FALLBACK_PATTERNS:
            for match in pattern.finditer(reasoning_content):
                candidate = normalize_answer(match.group("answer"))
                if candidate:
                    best_match = match
                    best_answer = candidate

        if best_match is None or best_answer is None:
            stripped_reasoning = reasoning_content.strip()

            structured_answer = extract_structured_visible_answer(stripped_reasoning)
            if structured_answer is not None:
                return None, structured_answer

            tool_call_payload = extract_tool_call_payload(stripped_reasoning)
            if tool_call_payload is not None:
                return None, tool_call_payload

            if TOOL_CALL_MARKUP_PATTERN.fullmatch(stripped_reasoning):
                return None, stripped_reasoning

            direct_answer = extract_direct_answer(stripped_reasoning)
            if direct_answer is not None:
                return None, direct_answer

            return reasoning_content, None

        trimmed_reasoning = reasoning_content[:best_match.start()].rstrip() or None
        return trimmed_reasoning, best_answer
