#!/usr/bin/env python3
# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
"""Lane entry points of the vllm-node-maya image.

    maya-lane        serve one model with Project Maya's engine and its patched server, in the
                     stack's hardened shape: flags the stack's tools already parse, Maya's config
                     written where the server cannot write, privacy switches forced, and nothing
                     about a request on stdout.
    maya-lane-pack   build the pack Maya serves from, beside the GGUF files. Provisioning runs it
                     (tools/download-weights.sh) with no network and ./models writable. Lanes
                     mount ./models read-only.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import os
import re
import shutil
import stat
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path

MAYA_ROOT = Path(os.environ.get("MAYA_LANE_ROOT", "/opt/maya"))
RUN_DIR = Path(os.environ.get("MAYA_LANE_RUN_DIR", "/run/maya"))
MODELS_ROOT = Path(os.environ.get("MAYA_LANE_MODELS_ROOT", "/models"))
ENGINE_LOG_LIMIT = 8 << 20

GGUF_PART = re.compile(r"^(.+)-(\d{5})-of-(\d{5})\.gguf$")
# What upstream's setup requires of a pack (maya.py, PACK_FILES).
PACK_FILES = ("index.txt", "native_experts.txt", "dense.bin", "tokenizer/vocab.json", "tokenizer/merges.txt",
              "tokenizer/token_type.json", "tokenizer/chat_template.jinja")

# Server settings forced on every start, whatever the container environment says.
FORCED_ENV = {
    "MAYA_MODEL_MANAGEMENT": "0",     # no load/unload/delete API
    "MAYA_UPDATE_CHECK": "0",         # no call home
    "MAYA_SAVINGS_PATH": "off",       # no usage ledger on disk
    "MAYA_SERVER_LOG": "0",           # the server's own lines stay out of the engine log
    "MAYA_EXPERT_DRIVE_PROBE": "0",   # no probe file under the config home
}
# Settings that would log request text or change what the lane runs.
REMOVED_ENV = ("MAYA_DEBUG", "MAYA_TURN_TRACE", "MAYA_PULL_COMMAND", "MAYA_RESTART_ON_UPDATE", "MAYA_API_KEY")
# Engine settings forced through the config: conversation slots are files beside the pack.
FORCED_ENGINE_ENV = {"MAYA_GLM_SLOTS": "0"}
# CUDA keeps compiled kernels under HOME (about 60 MB, written in the first second). HOME is RAM
# here and empty at every start, so the cache never serves a later start: it is left off.
FORCED_CUDA_ENV = {"CUDA_CACHE_DISABLE": "1"}
# Engine log lines worth showing at ready: how the memory was shared out.
ENGINE_SUMMARY = re.compile(r"unified memory|expert pool|all experts fit|RAM tier|CPU lane|glm multi")
ENGINE_FAILURE = re.compile(r"error|fail|abort|assert|out of memory|no room|killed|terminate", re.I)
# Memory (see "memory" below), in GB. What should still be free, not merely reclaimable, once the
# engine has taken its own: every start measured with 4 or more read prompts at full speed, every
# slow one had under 2. And what Maya keeps mapped of the model's files while it runs (the dense
# weights of GLM-5.3-Flash Maya-S: 7.0 measured), which counts as cache.
FREE_AT_READY_GB = 4
LOW_FREE_AT_READY_GB = 2.5
ENGINE_FILES_GB = 7
CACHED_FILE_MIN_BYTES = 1 << 20


class LaneError(Exception):
    """A start or a pack build that cannot go on; the message says what to do."""


def old_name(name: str) -> str:
    """Maya reads each MAYA_X setting under its older STRATA_X name too."""
    return "STRATA_" + name[len("MAYA_"):]


# ---- weights ----------------------------------------------------------------------------------

def gguf_shards(model_dir: Path) -> list[Path]:
    """The model's GGUF files, first shard first. Every file must resolve and a split set
    (<name>-0000N-of-0000M.gguf) must be whole."""
    if not model_dir.is_dir():
        raise LaneError(f"{model_dir} is not a folder")
    names = sorted(p.name for p in model_dir.iterdir() if p.name.endswith(".gguf"))
    if not names:
        raise LaneError(f"{model_dir} holds no GGUF file")
    for name in names:
        if not (model_dir / name).exists():
            raise LaneError(f"{model_dir / name} is a dangling link: the download is incomplete")
        part = GGUF_PART.match(name)
        if part:
            for i in range(1, int(part.group(3)) + 1):
                sibling = f"{part.group(1)}-{i:05d}-of-{part.group(3)}.gguf"
                if not (model_dir / sibling).exists():
                    raise LaneError(f"{model_dir / sibling} is missing: the download is incomplete")
    return [model_dir / name for name in names]


def pack_problem(model_dir: Path, pack: Path) -> str | None:
    """Why `pack` cannot be served, or None. The engine finds the GGUF files at <pack>/.."""
    if pack.parent.resolve() != model_dir.resolve():
        return f"the pack must sit in the model folder: {model_dir / pack.name}"
    missing = [f for f in PACK_FILES if not (pack / f).is_file()]
    if missing:
        return f"{pack / missing[0]} is missing"
    return None


def blob_sha256(shard: Path) -> str | None:
    """The sha256 a Hugging Face snapshot records for a file: the name of the blob its entry
    links to. Only that first link counts: newer hub versions link the blob on into a shared
    store whose names are another hash."""
    if not shard.is_symlink():
        return None
    name = Path(os.readlink(shard)).name
    return name if re.fullmatch(r"[0-9a-f]{64}", name) else None


def sha256_of(path: Path) -> str:
    with open(path, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


# ---- maya-lane-pack -----------------------------------------------------------------------------

def build_pack(model_dir: Path, pack: Path, out=sys.stderr) -> None:
    """Upstream's pack step (maya.py, pack_step) without its installer: check the files, run
    tools/iq_pack.py, add the base chat template when the GGUF carries none, stamp the sources.
    The pack is built aside and renamed, so a pack that exists is whole."""
    shards = gguf_shards(model_dir)
    if pack.parent.resolve() != model_dir.resolve():
        raise LaneError(f"the pack must sit in the model folder: {model_dir / pack.name}")
    if pack.exists():
        problem = pack_problem(model_dir, pack)
        if problem:
            raise LaneError(f"{pack} exists but is not whole ({problem}): remove it and run this again")
        print(f"pack already built: {pack}", file=out)
        return
    for stale in model_dir.glob(pack.name + ".building-*"):
        shutil.rmtree(stale)

    for shard in shards:
        want = blob_sha256(shard)
        if want is None:
            print(f"{shard.name}: not a Hugging Face blob link, sha256 not checked", file=out)
            continue
        print(f"{shard.name}: checking sha256 ...", file=out, flush=True)
        if sha256_of(shard) != want:
            raise LaneError(f"{shard.name}: the sha256 does not match its blob name: download it again")

    building = model_dir / f"{pack.name}.building-{os.getpid()}"
    env = dict(os.environ, MAYA_GGUF_PY=str(MAYA_ROOT / "third_party" / "llama.cpp" / "gguf-py"))
    command = [sys.executable, "-I", str(MAYA_ROOT / "tools" / "iq_pack.py"), "--gguf", str(shards[0]),
               "--out", str(building), "--compat-bf16"]
    try:
        if subprocess.run(command, env=env, cwd=str(MAYA_ROOT), check=False).returncode != 0:
            raise LaneError("the pack builder failed: the reason is in the lines above")
        template = building / "tokenizer" / "chat_template.jinja"
        base = MAYA_ROOT / "serve" / "glm5_chat_template.jinja"
        if not template.is_file() and base.is_file():
            template.write_bytes(base.read_bytes())
        missing = [f for f in PACK_FILES if not (building / f).is_file()]
        if missing:
            raise LaneError(f"the pack builder did not write {missing[0]}")
        files = [{"name": s.name, "size": s.stat().st_size, "mtime_ns": s.stat().st_mtime_ns} for s in shards]
        (building / "sources.json").write_text(json.dumps({"files": files}, indent=1), encoding="utf-8")
        os.rename(building, pack)
    finally:
        shutil.rmtree(building, ignore_errors=True)
    print(f"pack built: {pack}", file=out)


def pack_main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="maya-lane-pack", description="Build the pack Maya serves from.")
    ap.add_argument("--model-path", required=True, help="the folder of the model's GGUF files")
    ap.add_argument("--glm-pack", required=True, help="the pack to write: <model-path>/pack")
    a = ap.parse_args(argv)
    try:
        build_pack(Path(a.model_path), Path(a.glm_pack))
    except LaneError as e:
        print(f"maya-lane-pack: {e}", file=sys.stderr)
        return 1
    return 0


# ---- memory -------------------------------------------------------------------------------------
# On a unified-memory host the GPU's memory is the system's RAM. Maya sizes its expert pool from
# MemAvailable, which counts the file cache as free. When the engine's memory then leaves almost
# nothing free (the cache holds the rest), long prompts read about six times slower for as long
# as that engine runs: 130 against 750 tokens/s measured here on a 22K-token prompt, short
# prompts and the answer's own speed unchanged. Neither a restart nor freeing memory afterwards
# clears it. So before the engine starts the lane drops the cached copies of the weights (other
# lanes' too: the lane is exclusive), asks for more headroom when cache it cannot drop is in the
# way, and says so at ready when the start still ended short of free memory.

def meminfo(path: str = "/proc/meminfo") -> dict[str, int]:
    """/proc/meminfo's fields, in kB."""
    fields = {}
    try:
        with open(path, encoding="ascii", errors="replace") as f:
            for line in f:
                name, _, rest = line.partition(":")
                value = rest.split()
                if value and value[0].isdigit():
                    fields[name.strip()] = int(value[0])
    except OSError:
        pass
    return fields


def weight_files(root: Path, min_bytes: int = CACHED_FILE_MIN_BYTES) -> list[str]:
    """The large regular files under `root`. Links are left out: a Hugging Face snapshot links to
    blobs that the walk finds by themselves."""
    found = []
    for folder, _dirs, names in os.walk(root):
        for name in names:
            path = os.path.join(folder, name)
            try:
                st = os.lstat(path)
            except OSError:
                continue
            if stat.S_ISREG(st.st_mode) and st.st_size >= min_bytes:
                found.append(path)
    return found


def drop_file_cache(paths) -> int:
    """Ask the kernel to drop its cached pages of these files. Only clean pages that no process
    maps go, so nothing is lost: a later read comes from the disk. Returns the files asked for."""
    asked = 0
    for path in paths:
        try:
            fd = os.open(path, os.O_RDONLY)
        except OSError:
            continue
        try:
            os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
            asked += 1
        except OSError:
            pass
        finally:
            os.close(fd)
    return asked


def cache_in_the_way_gb(mem: dict[str, int]) -> float | None:
    """Memory that counts as available without being free, in GB: the file cache, mostly."""
    if "MemAvailable" not in mem or "MemFree" not in mem:
        return None
    return max(0, mem["MemAvailable"] - mem["MemFree"]) / (1 << 20)


def headroom_for(base_gb: float, mem: dict[str, int]) -> float:
    """The headroom to ask Maya for. Maya takes MemAvailable less its headroom, so the headroom
    has to cover the cache the lane could not drop and the model files Maya keeps mapped, and
    leave FREE_AT_READY_GB free beside them."""
    cache_gb = cache_in_the_way_gb(mem)
    if cache_gb is None:
        return base_gb
    return float(max(base_gb, math.ceil(cache_gb + ENGINE_FILES_GB + FREE_AT_READY_GB)))


def low_memory_note(mem: dict[str, int]) -> str | None:
    """What to say at ready when the engine's memory left too little free."""
    if "MemFree" not in mem or mem["MemFree"] / (1 << 20) >= LOW_FREE_AT_READY_GB:
        return None
    return (f"only {mem['MemFree'] / (1 << 20):.1f} GB is free after the engine took its memory: long prompts may "
            "read up to six times slower until the lane is started again (docs/troubleshooting.md)")


# ---- maya-lane ----------------------------------------------------------------------------------

def serve_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="maya-lane", description="Serve one model with Project Maya, hardened.")
    ap.add_argument("--model-path", help="the folder of the model's GGUF files, under /models")
    ap.add_argument("--glm-pack", help="the pack built beside them: <model-path>/pack")
    ap.add_argument("--served-model-name", required=True)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--context-length", type=int, required=True, help="the context the engine serves, in tokens")
    ap.add_argument("--parallel", type=int, default=1, help="requests answered at once (1-8)")
    ap.add_argument("--thinking-budget", type=int, default=None, help="the cap on thinking, in tokens")
    ap.add_argument("--reasoning-effort", choices=("none", "low", "high", "max"), default=None,
                    help="the thinking level of a request that names none (left out: the model's own)")
    ap.add_argument("--ram-headroom-gb", type=float, default=16.0,
                    help="memory the engine leaves free when it sizes its expert pool")
    ap.add_argument("--ablate-direction", help="the model's refusal direction file, under /models")
    ap.add_argument("--ablate", choices=("off", "on"), default="off",
                    help="on: project the refusal direction out of every request that does not send "
                         "\"ablate\": false. off (the default): the direction is not loaded")
    # The image's self-test runs the patched server with upstream's mock engine: no GPU, no model.
    ap.add_argument("--engine", choices=("maya", "mock"), default="maya", help=argparse.SUPPRESS)
    return ap


def harden_environment(env) -> None:
    """Force the server's switches and drop the settings that log request text, under both of the
    names Maya reads."""
    for name, value in FORCED_ENV.items():
        env[name] = value
        env[old_name(name)] = value
    for name in REMOVED_ENV:
        env.pop(name, None)
        env.pop(old_name(name), None)
    env.update(FORCED_CUDA_ENV)
    # Nothing under these is kept: the root filesystem is read-only and /tmp is RAM.
    env["HOME"] = "/tmp/home"
    env["XDG_CONFIG_HOME"] = "/tmp/home/.config"


def build_config(a, engine_log: Path, headroom_gb: float | None = None) -> dict:
    """Maya's run config, as its setup writes one for a GLM pack (maya.py, glm_config).
    `headroom_gb`: what this start asks for instead of --ram-headroom-gb (headroom_for)."""
    headroom_gb = a.ram_headroom_gb if headroom_gb is None else headroom_gb
    pack = Path(a.glm_pack)
    args = ["--glm-pack", str(pack), "--max-context", str(a.context_length), "--expert-cache", "auto",
            "--prefill", "auto", "--kv-streaming", "on"]
    if a.parallel > 1:
        args += ["--parallel", str(a.parallel)]
    profile = MAYA_ROOT / "data" / "expert-profile-glm.bin"
    if profile.is_file():
        args += ["--expert-profile", str(profile)]
    cfg = {
        "exe": str(MAYA_ROOT / "build" / "maya"),
        "args": args,
        "cwd": str(MAYA_ROOT),
        "tokenizer": str(pack / "tokenizer"),
        "model_name": a.served_model_name,
        "gpu": [0],
        # The folder names the quant, so Maya applies that tier's own sampling defaults.
        "installer": {"quant": Path(a.model_path).name},
        "model_management": False,
        "idle_unload_s": 0,
        "env": {**FORCED_ENGINE_ENV, "MAYA_GLM_RAM_HEADROOM_GB": f"{headroom_gb:g}"},
        "log": str(engine_log),
    }
    if a.thinking_budget is not None:
        cfg["thinking_budget"] = a.thinking_budget
    if a.reasoning_effort is not None:
        cfg["reasoning_effort"] = a.reasoning_effort
    if a.ablate == "on":
        # As Maya's setup writes it (serve/models.py, ablate_args): the engine loads the direction
        # and applies it to the requests the server marks; the server's default marks them all.
        cfg["args"] += ["--ablate", str(a.ablate_direction), "--ablate-default", "off"]
        cfg["ablate"] = {"file": str(a.ablate_direction), "default": True}
    return cfg


def write_config(cfg: dict, run_dir: Path) -> Path:
    """The config in a folder the server cannot write to: Maya creates answers/, a settings file
    and a usage ledger beside its config. Without CAP_DAC_OVERRIDE the mode bits bind root too."""
    cfg_dir = run_dir / "cfg"
    cfg_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(cfg_dir, 0o700)
    path = cfg_dir / "config.json"
    if path.exists():
        os.chmod(path, 0o600)
    path.write_text(json.dumps(cfg, indent=1), encoding="utf-8")
    os.chmod(path, 0o444)
    os.chmod(cfg_dir, 0o555)
    return path


class StdoutGate:
    """sys.stdout for the server. Maya prints its start, then a line per request, loop-guard lines
    that quote the model's output and whole malformed tool calls. Until the port is bound the
    lines are kept in memory, to explain a start that fails. Once it is bound they are dropped.
    With logging on, everything passes."""

    def __init__(self, stream, passthrough: bool, keep: int = 400):
        self.stream, self.passthrough = stream, passthrough
        self.lines: collections.deque = collections.deque(maxlen=keep)
        self.partial, self.closed, self.lock = "", False, threading.Lock()

    def write(self, text):
        if self.passthrough:
            return self.stream.write(text)
        with self.lock:
            if not self.closed:
                *whole, self.partial = (self.partial + text).split("\n")
                self.lines.extend(whole)
        return len(text)

    def flush(self):
        if self.passthrough:
            self.stream.flush()

    def kept(self) -> list[str]:
        with self.lock:
            return list(self.lines) + ([self.partial] if self.partial else [])

    def close(self) -> None:
        with self.lock:
            self.closed, self.partial = True, ""
            self.lines.clear()

    def __getattr__(self, name):
        return getattr(self.stream, name)


def still_on(server, svc) -> list[str]:
    """What should be off in a hardened lane and is not, read from the running server."""
    problems = []
    if getattr(server, "JOBS_DIR", None) is not None:
        problems.append("the web app's answers folder is writable")
    if getattr(getattr(svc, "savings", None), "path", None) is not None:
        problems.append("the usage ledger has a file")
    if getattr(svc, "model_management", False):
        problems.append("model management is on")
    if getattr(svc, "mcp", None) is not None:
        problems.append("an MCP hub is running")
    if getattr(svc, "vision", None) is not None:
        problems.append("a vision encoder is loaded")
    return problems


def log_lines(path: Path) -> list[str]:
    try:
        return path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []


def keep_log_small(path: Path, limit: int = ENGINE_LOG_LIMIT, every_s: float = 60.0) -> None:
    """The engine appends to its log for as long as it runs; the log lives in RAM."""
    while True:
        time.sleep(every_s)
        try:
            if path.stat().st_size > limit:
                os.truncate(path, 0)
        except OSError:
            pass


def run_server(server_argv: list[str], engine_log: Path | None, logging_on: bool) -> int:
    """Run the patched server in this process. Returns its exit code."""
    say = lambda text: print(f"maya-lane: {text}", file=sys.stderr, flush=True)   # noqa: E731
    sys.dont_write_bytecode = True
    gate = StdoutGate(sys.stdout, passthrough=logging_on)
    if not logging_on:
        # fd 1 itself, so a child process cannot print there either. Our own lines go to stderr.
        sys.stdout.flush()
        os.dup2(os.open(os.devnull, os.O_WRONLY), 1)
    sys.stdout = gate
    ready = threading.Event()

    def explain_failed_start() -> None:
        for line in gate.kept():
            print(line, file=sys.stderr)
        if engine_log is not None:
            for line in log_lines(engine_log)[-100:]:
                print(f"engine: {line}", file=sys.stderr)
        sys.stderr.flush()

    try:
        sys.path[:0] = [str(MAYA_ROOT / "tools"), str(MAYA_ROOT)]
        from serve import server   # Project Maya's server, patched (patches/)

        serve = server.serve

        def serve_then_close_stdout(svc, host="127.0.0.1", port=8095):
            httpd = serve(svc, host=host, port=port)
            problems = still_on(server, svc)
            if problems:
                say("refusing to serve: " + "; ".join(problems))
                os._exit(78)
            if engine_log is not None:
                for line in log_lines(engine_log):
                    if ENGINE_SUMMARY.search(line):
                        print(f"engine: {line}", file=sys.stderr)
                threading.Thread(target=keep_log_small, args=(engine_log,), daemon=True).start()
                mem = meminfo()
                if "MemFree" in mem and "MemAvailable" in mem:
                    say(f"memory at ready: {mem['MemFree'] / (1 << 20):.1f} GB free, "
                        f"{mem['MemAvailable'] / (1 << 20):.1f} GB available")
                note = low_memory_note(mem)
                if note:
                    say(note)
            say(f"ready on {host}:{port}: {getattr(svc, 'model', '?')}, context "
                f"{getattr(getattr(svc, 'engine', None), 'max_context', '?')} tokens"
                + ("" if logging_on else "; request logging is off (VLLM_LOGGING=1 turns it on)"))
            gate.close()
            ready.set()
            return httpd

        server.serve = serve_then_close_stdout
        sys.argv = ["maya-lane", *server_argv]
        code = server.main()
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
        if not isinstance(e.code, int) and e.code is not None:
            say(str(e.code))
    except BaseException:   # noqa: BLE001 (the reason must reach the container log)
        traceback.print_exc()
        code = 1
    code = code or 0
    if not ready.is_set():
        explain_failed_start()
        say(f"the server stopped before it was ready (exit {code or 1})")
        return code or 1
    if code and engine_log is not None:
        for line in [ln for ln in log_lines(engine_log) if ENGINE_FAILURE.search(ln)][-20:]:
            print(f"engine: {line}", file=sys.stderr)
    return code


def serve_main(argv: list[str]) -> int:
    a = serve_parser().parse_args(argv)
    logging_on = os.environ.get("MAYA_LANE_LOGGING", "0").strip().lower() in ("1", "on", "true", "yes")
    api_key = os.environ.get("VLLM_API_KEY", "")
    try:
        if not api_key:
            raise LaneError("VLLM_API_KEY is not set: the lane does not serve without an API key")
        if not 1 <= a.parallel <= 8:
            raise LaneError("--parallel takes 1 to 8")
        harden_environment(os.environ)
        os.environ["MAYA_API_KEY"] = api_key
        os.makedirs(os.environ["XDG_CONFIG_HOME"], exist_ok=True)
        server_argv = ["--engine", a.engine, "--host", a.host, "--port", str(a.port)]
        engine_log = None
        if a.engine == "maya":
            if not a.model_path or not a.glm_pack:
                raise LaneError("--model-path and --glm-pack are required")
            model_dir, pack = Path(a.model_path), Path(a.glm_pack)
            gguf_shards(model_dir)
            problem = pack_problem(model_dir, pack)
            if problem:
                raise LaneError(f"{problem}. Build it with: bash tools/download-weights.sh {a.served_model_name}")
            if a.ablate == "on" and not (a.ablate_direction and Path(a.ablate_direction).is_file()):
                raise LaneError("--ablate on needs the refusal direction file: --ablate-direction "
                                f"{a.ablate_direction or '<file>'} is not there")
            log_dir = RUN_DIR / "log"
            log_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            engine_log = log_dir / "engine.log"
            engine_log.write_text("", encoding="utf-8")
            drop_file_cache(weight_files(MODELS_ROOT))
            mem = meminfo()
            headroom = headroom_for(a.ram_headroom_gb, mem)
            if headroom > a.ram_headroom_gb:
                print(f"maya-lane: {cache_in_the_way_gb(mem):.0f} GB of file cache that this lane cannot drop "
                      f"is in the way: asking for {headroom:g} GB of headroom instead of {a.ram_headroom_gb:g}, "
                      "so fewer experts stay in memory", file=sys.stderr)
            server_argv += ["--config", str(write_config(build_config(a, engine_log, headroom), RUN_DIR))]
    except (LaneError, OSError) as e:
        print(f"maya-lane: {e}", file=sys.stderr)
        return 2
    return run_server(server_argv, engine_log, logging_on)


def main() -> int:
    name = Path(sys.argv[0]).name
    if name == "maya-lane-pack" or sys.argv[1:2] == ["pack"]:
        return pack_main(sys.argv[2:] if sys.argv[1:2] == ["pack"] else sys.argv[1:])
    return serve_main(sys.argv[2:] if sys.argv[1:2] == ["serve"] else sys.argv[1:])


if __name__ == "__main__":
    sys.exit(main())
