# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
"""Build gate of the vllm-node-maya image: the patched server behind maya-lane, driven with
upstream's mock engine. No GPU, no model, loopback only.

It proves what the lane relies on: four routes answer and every other one is a 404, a browser
Origin is not refused, the web app's request fields change nothing, nothing about a request is
printed once the server is ready, and nothing is written into the image.
"""
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

PORT = 18765
KEY = "selftest-key"
CANARY = "canary-7f3a91"
BASE = f"http://127.0.0.1:{PORT}"
CHAT = {"model": "anything", "messages": [{"role": "user", "content": f"Say hello. {CANARY}"}], "max_tokens": 64}
FAILURES = []


def check(label, ok, detail=""):
    print(("OK:   " if ok else "FAIL: ") + label + (f" ({detail})" if detail and not ok else ""))
    if not ok:
        FAILURES.append(label)


def call(method, path, body=None, key=KEY, headers=None):
    request = urllib.request.Request(BASE + path, method=method,
                                     data=None if body is None else json.dumps(body).encode())
    if body is not None:
        request.add_header("Content-Type", "application/json")
    if key:
        request.add_header("Authorization", f"Bearer {key}")
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def start(logging):
    env = {"PATH": os.environ["PATH"], "VLLM_API_KEY": KEY, "MAYA_LANE_LOGGING": logging,
           # Settings the wrapper must override or drop.
           "MAYA_DEBUG": "1", "MAYA_MODEL_MANAGEMENT": "1", "MAYA_UPDATE_CHECK": "1"}
    process = subprocess.Popen(
        ["maya-lane", "--engine", "mock", "--served-model-name", "selftest", "--host", "127.0.0.1",
         "--port", str(PORT), "--context-length", "4096"],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    deadline = time.time() + 60
    while time.time() < deadline and process.poll() is None:
        try:
            if call("GET", "/health", key=None)[0] == 200:
                return process
        except OSError:
            time.sleep(0.2)
    process.kill()
    out, err = process.communicate()
    sys.exit(f"selftest: the server did not come up\n{out.decode()}\n{err.decode()}")


def stop(process):
    process.send_signal(signal.SIGTERM)
    try:
        out, err = process.communicate(timeout=90)
    except subprocess.TimeoutExpired:
        process.kill()
        out, err = process.communicate()
        check("stops on SIGTERM", False, "killed after 90 s")
    return process.returncode, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")


def written_since(marker):
    out = subprocess.run(["find", "/opt/maya", "/opt/lane", "-newer", marker, "-not", "-path", "*/.venv/*"],
                         capture_output=True, text=True).stdout.split()
    return [p for p in out if p != marker]


def main():
    marker = "/tmp/selftest-marker"
    open(marker, "w").close()
    time.sleep(1.1)

    server = start("0")
    status, body = call("GET", "/health", key=None)
    check("GET /health answers without a key", status == 200, body[:120])

    status, body = call("POST", "/v1/chat/completions", CHAT)
    answer = json.loads(body) if status == 200 else {}
    check("chat completion answers", status == 200 and bool(answer.get("choices")), body[:200])
    check("usage is reported", (answer.get("usage") or {}).get("prompt_tokens", 0) > 0, body[:200])
    check("chat without a key is 401", call("POST", "/v1/chat/completions", CHAT, key=None)[0] == 401)

    status, body = call("POST", "/v1/chat/completions", CHAT, headers={"Origin": "vscode-webview://selftest"})
    check("a browser Origin is not refused", status == 200, f"{status} {body[:160]}")

    status, body = call("POST", "/v1/chat/completions", {**CHAT, "stream": True, "strata_resume": True, "strata_mcp": True})
    check("a stream ends with [DONE], the web app's fields ignored", status == 200 and "data: [DONE]" in body, body[-200:])

    status, body = call("POST", "/tokenize", {"model": "anything", "messages": [{"role": "user", "content": "hello"}]})
    tokens = json.loads(body) if status == 200 else {}
    check("tokenize returns count and tokens", status == 200 and tokens.get("count", 0) > 0 and bool(tokens.get("tokens")), body[:160])
    status, body = call("POST", "/detokenize", {"model": "anything", "tokens": tokens.get("tokens", [])})
    check("detokenize returns the prompt", status == 200 and "hello" in json.loads(body).get("prompt", ""), body[:160])

    denied = [("GET", p) for p in ("/", "/web/app.js", "/fonts/x.woff2", "/v1/models", "/models", "/props", "/slots",
                                   "/status", "/v1/status", "/metrics", "/metrics/prometheus", "/settings", "/mcp",
                                   "/models/sse", "/api/tags", "/api/ps", "/api/version", "/api/update", "/api/report",
                                   "/v1/responses/x", "/v1/strata/stream")]
    denied += [("POST", p) for p in ("/v1/responses", "/v1/messages", "/v1/completions", "/v1/strata/stream",
                                     "/v1/strata/cancel", "/api/pull", "/api/delete", "/api/chat", "/api/generate",
                                     "/api/show", "/models/load", "/models/unload", "/settings", "/attach", "/pdf",
                                     "/api/context", "/api/port", "/api/update", "/api/tokens")]
    denied += [("DELETE", "/v1/responses/x"), ("DELETE", "/api/delete"), ("OPTIONS", "/v1/chat/completions")]
    wrong = []
    for method, path in denied:
        for key in (KEY, None):
            status = call(method, path, {"model": "anything"} if method == "POST" else None, key=key)[0]
            if status != 404:
                wrong.append(f"{method} {path} -> {status}")
    check(f"{len(denied)} other routes are 404, with or without the key", not wrong, "; ".join(wrong[:6]))

    code, out, err = stop(server)
    check("stops cleanly on SIGTERM", code == 0, f"exit {code}: {err[-300:]}")
    check("nothing on stdout", out == "", out[:200])
    check("the ready line is on stderr", "maya-lane: ready on" in err, err[-300:])
    check("no request line or prompt text in the log", CANARY not in err and "done:" not in err and "raw:" not in err,
          err[-300:])
    check("debug settings were dropped", "MAYA_DEBUG" not in err)

    written = written_since(marker)
    check("nothing written into the image", not written, " ".join(written[:5]))

    # The gate, not Maya, is what keeps request lines out: with logging on they are printed.
    server = start("1")
    call("POST", "/v1/chat/completions", CHAT)
    code, out, err = stop(server)
    check("VLLM_LOGGING=1 shows the server's lines", "done:" in out, out[-300:])
    check("no prompt text even with logging on", CANARY not in out and CANARY not in err)

    if FAILURES:
        sys.exit(f"selftest: {len(FAILURES)} check(s) failed")
    print("selftest: all checks passed")


if __name__ == "__main__":
    main()
