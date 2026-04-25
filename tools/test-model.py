#!/usr/bin/env python3

import argparse
import json
import os

import requests


def parse_args():
    parser = argparse.ArgumentParser(description="Generic model tester for the DGX Spark stack")
    parser.add_argument("--model", type=str, required=True, help="Model name to test")
    parser.add_argument("--base-url", type=str, default="http://localhost:8009/v1", help="Base API URL")
    parser.add_argument(
        "--api-key",
        type=str,
        default=os.getenv("VLLM_API_KEY", "63TestTOKEN0REPLACEME"),
        help="API key",
    )
    parser.add_argument("--tool-call", action="store_true", help="Test tool-calling capability")
    parser.add_argument(
        "--prompt",
        type=str,
        default="How many r's are in the word strawberry?",
        help="Custom user prompt",
    )
    parser.add_argument("--temperature", type=float, default=0.6, help="Temperature for generation")
    return parser.parse_args()


def print_separator(title):
    print(f"\n{'=' * 20} {title} {'=' * 20}")


def test_model(args):
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {args.api_key}",
    }

    messages = [{"role": "user", "content": args.prompt}]
    payload = {
        "model": args.model,
        "messages": messages,
        "temperature": args.temperature,
    }

    if args.tool_call:
        print_separator(f"Testing tool calling on {args.model}")
        messages[0]["content"] = "Call the tool get_weather for Zurich"
        if args.prompt == "How many r's are in the word strawberry?":
            messages[0]["content"] = "What is the weather in Zurich?"

        payload["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "description": "Get current weather for a location",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "city": {"type": "string", "description": "The city name"},
                            "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]},
                        },
                        "required": ["city"],
                    },
                },
            }
        ]
        payload["tool_choice"] = "auto"
    else:
        print_separator(f"Testing standard generation on {args.model}")

    print("\n--- Request payload ---")
    print(json.dumps(payload, indent=2))

    try:
        print("\nSending request...", end="", flush=True)
        response = requests.post(
            f"{args.base_url}/chat/completions",
            headers=headers,
            json=payload,
            timeout=120,
        )
        print(" done.")

        print("\n--- Response status code ---")
        print(response.status_code)

        response.raise_for_status()
        data = response.json()

        print("\n--- Response JSON ---")
        print(json.dumps(data, indent=2))

        choice = data["choices"][0]
        message = choice["message"]
        content = message.get("content")
        tool_calls = message.get("tool_calls")

        print_separator("Analysis")

        if tool_calls:
            print(f"OK: tool calls detected: {len(tool_calls)}")
            for tool_call in tool_calls:
                print(f"  - Function: {tool_call['function']['name']}")
                print(f"  - Arguments: {tool_call['function']['arguments']}")
        elif args.tool_call:
            print("FAIL: no tool calls found in response.")

        if content:
            print("\nContent preview:")
            print(content[:500] + ("..." if len(content) > 500 else ""))

            if "<think>" in content:
                print("\nOK: <think> tag detected.")
            else:
                print("\nINFO: no <think> tag detected.")
        else:
            print("\nINFO: no content in message (normal for pure tool calls).")

    except Exception as exc:
        print(f"\nFAIL: {exc}")
        if "response" in locals():
            print(f"Response text: {response.text}")


if __name__ == "__main__":
    test_model(parse_args())
