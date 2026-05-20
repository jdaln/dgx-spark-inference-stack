import unittest

try:
    from vllm.entrypoints.openai.engine.protocol import DeltaMessage
except ModuleNotFoundError:
    from vllm.entrypoints.openai.protocol import DeltaMessage

from qwen3_opus_distilled_reasoning_parser import Qwen3OpusDistilledReasoningParser


class FakeTokenizer:
    def get_vocab(self):
        return {
            "<think>": 1,
            "</think>": 2,
        }


class Qwen3OpusDistilledReasoningParserTest(unittest.TestCase):
    def make_parser(self, enable_thinking=True):
        return Qwen3OpusDistilledReasoningParser(
            FakeTokenizer(),
            chat_template_kwargs={"enable_thinking": enable_thinking},
        )

    def test_non_streaming_fallback_extracts_final_answer(self):
        parser = self.make_parser()
        reasoning, content = parser.extract_reasoning(
            "Let me think through this carefully.\n\nThe answer is 4.",
            None,
        )

        self.assertEqual(reasoning, "Let me think through this carefully.")
        self.assertEqual(content, "4")

    def test_non_streaming_fallback_unwraps_embedded_indeed_answer(self):
        parser = self.make_parser()
        reasoning, content = parser.extract_reasoning(
            "Let me think through this carefully.\n\nThe answer is indeed 4, which is a single digit.",
            None,
        )

        self.assertEqual(reasoning, "Let me think through this carefully.")
        self.assertEqual(content, "4")

    def test_non_streaming_promotes_bare_reasoning_answer(self):
        parser = self.make_parser()
        reasoning, content = parser.extract_reasoning("READY.", None)

        self.assertIsNone(reasoning)
        self.assertEqual(content, "READY")

    def test_non_streaming_promotes_reasoning_tool_markup(self):
        parser = self.make_parser()
        tool_markup = (
            "<tool_call>\n"
            "<function=get_weather>\n"
            "<parameter=city>\n"
            "Paris\n"
            "</parameter>\n"
            "</function>\n"
            "</tool_call>"
        )
        reasoning, content = parser.extract_reasoning(tool_markup, None)

        self.assertIsNone(reasoning)
        self.assertEqual(content, tool_markup)

    def test_non_streaming_promotes_structured_heading_answer(self):
        parser = self.make_parser()
        structured_answer = (
            "# Summary\n"
            "This stack serves LLM requests.\n\n"
            "# Risks\n"
            "- Gateway bottlenecks\n"
            "- Validator latency"
        )

        reasoning, content = parser.extract_reasoning(structured_answer, None)

        self.assertIsNone(reasoning)
        self.assertEqual(content, structured_answer)

    def test_non_streaming_promotes_bare_function_tool_markup(self):
        parser = self.make_parser()
        tool_markup = (
            "<function=get_weather>\n"
            "<parameter=city>\n"
            "Paris\n"
            "</parameter>\n"
            "</function>"
        )

        reasoning, content = parser.extract_reasoning(tool_markup, None)

        self.assertIsNone(reasoning)
        self.assertEqual(content, tool_markup)

    def test_non_streaming_promotes_json_tool_array(self):
        parser = self.make_parser()
        tool_payload = (
            "[\n"
            "  {\n"
            "    \"name\": \"get_weather\",\n"
            "    \"parameters\": {\n"
            "      \"city\": \"Paris\"\n"
            "    }\n"
            "  }\n"
            "]"
        )

        reasoning, content = parser.extract_reasoning(tool_payload, None)

        self.assertIsNone(reasoning)
        self.assertEqual(content, tool_payload)

    def test_streaming_fallback_emits_content_without_end_token(self):
        parser = self.make_parser()
        result = parser.extract_reasoning_streaming(
            "Let me think through this carefully.\n\nThe answer",
            "Let me think through this carefully.\n\nThe answer is 4.",
            " is 4.",
            [10, 11],
            [10, 11, 12],
            [12],
        )

        self.assertIsNone(result.reasoning)
        self.assertEqual(result.content, "4")

    def test_streaming_fallback_promotes_bare_reasoning_answer(self):
        parser = self.make_parser()
        result = parser.extract_reasoning_streaming(
            "",
            "4",
            "4",
            [],
            [14],
            [14],
        )

        self.assertIsNone(result.reasoning)
        self.assertEqual(result.content, "4")

    def test_streaming_fallback_promotes_structured_heading_answer(self):
        parser = self.make_parser()
        structured_answer = "# Summary\nShort summary\n\n# Risks\n- Risk"
        result = parser.extract_reasoning_streaming(
            "",
            structured_answer,
            structured_answer,
            [],
            [14],
            [14],
        )

        self.assertIsNone(result.reasoning)
        self.assertEqual(result.content, structured_answer)

    def test_streaming_fallback_does_not_override_real_content_mode(self):
        parser = self.make_parser()
        result = parser.extract_reasoning_streaming(
            "Reasoning",
            "Reasoning4",
            "4",
            [9, 2],
            [9, 2, 13],
            [13],
        )

        self.assertEqual(result.content, "4")
        self.assertIsNone(result.reasoning)

    def test_streaming_content_mode_prefers_clean_answer_over_noisy_text(self):
        parser = self.make_parser()
        result = parser.extract_reasoning_streaming(
            "Let me think carefully.",
            "Let me think carefully.\n\nindeed 4, which is a single digit",
            "indeed 4, which is a single digit",
            [2],
            [2, 13],
            [13],
        )

        self.assertEqual(result.content, "4")
        self.assertIsNone(result.reasoning)

    def test_streaming_content_mode_waits_for_complete_wrapper(self):
        parser = self.make_parser()
        result = parser.extract_reasoning_streaming(
            "Let me think carefully.",
            "Let me think carefully.\n\nThe answer is indeed 4, which",
            "indeed 4, which",
            [2],
            [2, 13],
            [13],
        )

        self.assertIsNone(result)

    def test_streaming_content_mode_unwraps_filler_prefix_and_latches_answer(self):
        parser = self.make_parser()

        first = parser.extract_reasoning_streaming(
            "Let me think carefully.\n\nThe answer is",
            "Let me think carefully.\n\nThe answer is indeed",
            "indeed",
            [2],
            [2, 13],
            [13],
        )

        second = parser.extract_reasoning_streaming(
            "Let me think carefully.\n\nThe answer is indeed",
            "Let me think carefully.\n\nThe answer is indeed 4",
            " 4",
            [2, 13],
            [2, 13, 14],
            [14],
        )

        third = parser.extract_reasoning_streaming(
            "Let me think carefully.\n\nThe answer is indeed 4",
            "Let me think carefully.\n\nThe answer is indeed 4, which",
            " which",
            [2, 13, 14],
            [2, 13, 14, 15],
            [15],
        )

        self.assertIsNone(first)
        self.assertEqual(second.content, "4")
        self.assertIsNone(second.reasoning)
        self.assertIsNone(third)

    def test_streaming_content_mode_buffers_noisy_text_before_passthrough(self):
        parser = self.make_parser()
        result = parser.extract_reasoning_streaming(
            "Reasoning",
            "Reasoning partial raw content",
            "partial raw content",
            [2],
            [2, 13],
            [13],
        )

        self.assertIsNone(result)

    def test_streaming_content_mode_extracts_buffered_fallback_answer(self):
        parser = self.make_parser()
        result = parser.handle_streaming_content(
            "Reasoning",
            "Reasoning",
            DeltaMessage(content="indeed 4, which is a single digit"),
        )

        self.assertEqual(result.content, "4")
        self.assertIsNone(result.reasoning)


if __name__ == "__main__":
    unittest.main()
