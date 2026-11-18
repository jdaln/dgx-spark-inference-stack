# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
"""Unit tests for maya_lane.py. They need no GPU, no model and no Maya source:

    docker run --rm -v "$PWD":/workspace:ro -w /workspace/custom-docker-containers/vllm-node-maya \
      python:3.12-slim python -B -m unittest -v test_maya_lane
"""
import hashlib
import io
import json
import os
import stat
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import maya_lane  # noqa: E402


def make_tier(root: Path, parts: int = 3, present=(1, 2, 3)) -> Path:
    """A tier folder as hf lays it out: split GGUF files linked into blobs named by sha256."""
    tier = root / "snapshots" / "rev" / "Tier-S"
    blobs = root / "blobs"
    tier.mkdir(parents=True)
    blobs.mkdir()
    for n in present:
        data = f"shard {n}".encode()
        blob = blobs / hashlib.sha256(data).hexdigest()
        blob.write_bytes(data)
        (tier / f"m-{n:05d}-of-{parts:05d}.gguf").symlink_to(blob)
    return tier


def fake_maya_root(root: Path, with_template: bool = False, fail: bool = False) -> Path:
    """A stand-in for /opt/maya whose iq_pack.py writes a pack's files."""
    (root / "tools").mkdir(parents=True)
    (root / "serve").mkdir()
    (root / "serve" / "glm5_chat_template.jinja").write_text("base template")
    files = [f for f in maya_lane.PACK_FILES if with_template or not f.endswith("chat_template.jinja")]
    (root / "tools" / "iq_pack.py").write_text(
        "import pathlib, sys\n"
        f"if {fail!r}: sys.exit(3)\n"
        "out = pathlib.Path(sys.argv[sys.argv.index('--out') + 1])\n"
        "assert '--compat-bf16' in sys.argv\n"
        f"for f in {files!r}:\n"
        "    (out / f).parent.mkdir(parents=True, exist_ok=True)\n"
        "    (out / f).write_text('from the gguf')\n")
    return root


class Weights(unittest.TestCase):
    def test_whole_split_set_is_listed_first_shard_first(self):
        with tempfile.TemporaryDirectory() as d:
            tier = make_tier(Path(d))
            self.assertEqual([p.name for p in maya_lane.gguf_shards(tier)],
                             ["m-00001-of-00003.gguf", "m-00002-of-00003.gguf", "m-00003-of-00003.gguf"])

    def test_a_missing_part_a_dangling_link_and_an_empty_folder_are_refused(self):
        with tempfile.TemporaryDirectory() as d:
            tier = make_tier(Path(d), present=(1, 3))
            with self.assertRaisesRegex(maya_lane.LaneError, "m-00002-of-00003.gguf is missing"):
                maya_lane.gguf_shards(tier)
        with tempfile.TemporaryDirectory() as d:
            tier = make_tier(Path(d))
            (tier / "other.gguf").symlink_to(Path(d) / "blobs" / "absent")
            with self.assertRaisesRegex(maya_lane.LaneError, "dangling link"):
                maya_lane.gguf_shards(tier)
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(maya_lane.LaneError, "no GGUF file"):
                maya_lane.gguf_shards(Path(d))

    def test_blob_name_is_the_expected_sha256(self):
        with tempfile.TemporaryDirectory() as d:
            tier = make_tier(Path(d))
            shard = tier / "m-00001-of-00003.gguf"
            self.assertEqual(maya_lane.blob_sha256(shard), hashlib.sha256(b"shard 1").hexdigest())
            self.assertEqual(maya_lane.sha256_of(shard), maya_lane.blob_sha256(shard))
            plain = Path(d) / "plain.gguf"
            plain.write_bytes(b"x")
            self.assertIsNone(maya_lane.blob_sha256(plain))

    def test_a_blob_linked_on_into_a_shared_store_keeps_its_sha256_name(self):
        # Newer hub versions: snapshot entry -> blobs/<sha256> -> ../../blobs/<2 hex>/<another hash>.
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            data = b"shard"
            sha = hashlib.sha256(data).hexdigest()
            store = root / "blobs" / "ab"
            store.mkdir(parents=True)
            (store / ("ab" + "0" * 62)).write_bytes(data)
            repo_blobs = root / "models--org--m" / "blobs"
            repo_blobs.mkdir(parents=True)
            (repo_blobs / sha).symlink_to(store / ("ab" + "0" * 62))
            tier = root / "models--org--m" / "snapshots" / "rev" / "Tier-S"
            tier.mkdir(parents=True)
            (tier / "m.gguf").symlink_to(repo_blobs / sha)
            self.assertEqual(maya_lane.blob_sha256(tier / "m.gguf"), sha)
            self.assertEqual(maya_lane.sha256_of(tier / "m.gguf"), sha)

    def test_pack_must_be_whole_and_beside_the_shards(self):
        with tempfile.TemporaryDirectory() as d:
            tier = make_tier(Path(d))
            pack = tier / "pack"
            self.assertIn("index.txt is missing", maya_lane.pack_problem(tier, pack))
            for f in maya_lane.PACK_FILES:
                (pack / f).parent.mkdir(parents=True, exist_ok=True)
                (pack / f).write_text("x")
            self.assertIsNone(maya_lane.pack_problem(tier, pack))
            self.assertIn("must sit in the model folder", maya_lane.pack_problem(tier, Path(d) / "pack"))


class PackBuild(unittest.TestCase):
    def build(self, d: Path, **root_options):
        tier = make_tier(d / "repo")
        with mock.patch.object(maya_lane, "MAYA_ROOT", fake_maya_root(d / "maya", **root_options)):
            maya_lane.build_pack(tier, tier / "pack", out=io.StringIO())
        return tier

    def test_pack_is_built_aside_stamped_and_gets_the_base_template(self):
        with tempfile.TemporaryDirectory() as d:
            tier = self.build(Path(d))
            pack = tier / "pack"
            self.assertIsNone(maya_lane.pack_problem(tier, pack))
            self.assertEqual((pack / "tokenizer" / "chat_template.jinja").read_text(), "base template")
            sources = json.loads((pack / "sources.json").read_text())
            self.assertEqual([f["name"] for f in sources["files"]], [p.name for p in maya_lane.gguf_shards(tier)])
            self.assertEqual(list(tier.glob("pack.building-*")), [])

    def test_a_template_from_the_gguf_is_kept(self):
        with tempfile.TemporaryDirectory() as d:
            tier = self.build(Path(d), with_template=True)
            self.assertEqual((tier / "pack" / "tokenizer" / "chat_template.jinja").read_text(), "from the gguf")

    def test_an_existing_pack_is_left_alone(self):
        with tempfile.TemporaryDirectory() as d:
            tier = self.build(Path(d))
            before = (tier / "pack" / "index.txt").stat().st_mtime_ns
            with mock.patch.object(maya_lane, "MAYA_ROOT", Path(d) / "maya"):
                maya_lane.build_pack(tier, tier / "pack", out=io.StringIO())
            self.assertEqual((tier / "pack" / "index.txt").stat().st_mtime_ns, before)

    def test_a_damaged_shard_or_a_failed_builder_leaves_no_pack(self):
        with tempfile.TemporaryDirectory() as d:
            tier = make_tier(Path(d) / "repo")
            Path(os.path.realpath(tier / "m-00002-of-00003.gguf")).write_bytes(b"damaged")
            with mock.patch.object(maya_lane, "MAYA_ROOT", fake_maya_root(Path(d) / "maya")):
                with self.assertRaisesRegex(maya_lane.LaneError, "sha256 does not match"):
                    maya_lane.build_pack(tier, tier / "pack", out=io.StringIO())
            self.assertFalse((tier / "pack").exists())
        with tempfile.TemporaryDirectory() as d:
            tier = make_tier(Path(d) / "repo")
            with mock.patch.object(maya_lane, "MAYA_ROOT", fake_maya_root(Path(d) / "maya", fail=True)):
                with self.assertRaisesRegex(maya_lane.LaneError, "pack builder failed"):
                    maya_lane.build_pack(tier, tier / "pack", out=io.StringIO())
            self.assertFalse((tier / "pack").exists())
            self.assertEqual(list(tier.glob("pack.building-*")), [])


class Config(unittest.TestCase):
    def args(self, *extra):
        return maya_lane.serve_parser().parse_args([
            "--model-path", "/models/x/Tier-S", "--glm-pack", "/models/x/Tier-S/pack",
            "--served-model-name", "lane-id", "--context-length", "131072", *extra])

    def test_config_mirrors_upstream_setup_and_adds_nothing_else(self):
        cfg = maya_lane.build_config(self.args("--parallel", "4", "--thinking-budget", "4096",
                                               "--ram-headroom-gb", "20"), Path("/run/maya/log/engine.log"))
        self.assertEqual(cfg["args"][:10], ["--glm-pack", "/models/x/Tier-S/pack", "--max-context", "131072",
                                            "--expert-cache", "auto", "--prefill", "auto", "--kv-streaming", "on"])
        self.assertEqual(cfg["args"][10:12], ["--parallel", "4"])
        self.assertEqual(cfg["tokenizer"], "/models/x/Tier-S/pack/tokenizer")
        self.assertEqual(cfg["model_name"], "lane-id")
        self.assertEqual(cfg["installer"], {"quant": "Tier-S"})
        self.assertEqual(cfg["thinking_budget"], 4096)
        self.assertEqual(cfg["env"], {"MAYA_GLM_SLOTS": "0", "MAYA_GLM_RAM_HEADROOM_GB": "20"})
        self.assertIs(cfg["model_management"], False)
        self.assertEqual(cfg["idle_unload_s"], 0)
        for key in ("api_key", "cors_origins", "mcp_servers", "vision", "host", "port", "sampling"):
            self.assertNotIn(key, cfg)

    def test_one_request_at_a_time_passes_no_parallel_flag(self):
        cfg = maya_lane.build_config(self.args(), Path("/run/maya/log/engine.log"))
        self.assertNotIn("--parallel", cfg["args"])
        self.assertNotIn("thinking_budget", cfg)
        self.assertNotIn("reasoning_effort", cfg)                # left out: the model's own level

    def test_default_thinking_level_is_written_in_maya_s_words(self):
        cfg = maya_lane.build_config(self.args("--reasoning-effort", "max", "--thinking-budget", "32768"),
                                     Path("/run/maya/log/engine.log"))
        self.assertEqual(cfg["reasoning_effort"], "max")
        self.assertEqual(cfg["thinking_budget"], 32768)
        with self.assertRaises(SystemExit), mock.patch("sys.stderr", io.StringIO()):
            self.args("--reasoning-effort", "xhigh")             # GLM has no such level: say max

    def test_refusal_ablation_is_off_unless_switched_on(self):
        direction = "/models/x/refusal-directions/m-refusal-direction.gguf"
        off = maya_lane.build_config(self.args("--ablate-direction", direction), Path("/run/maya/log/engine.log"))
        self.assertNotIn("--ablate", off["args"])
        self.assertNotIn("ablate", off)
        on = maya_lane.build_config(self.args("--ablate-direction", direction, "--ablate", "on"),
                                    Path("/run/maya/log/engine.log"))
        self.assertEqual(on["args"][-4:], ["--ablate", direction, "--ablate-default", "off"])
        self.assertEqual(on["ablate"], {"file": direction, "default": True})

    def test_ablation_on_without_its_direction_file_is_refused(self):
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.dict(os.environ, {"VLLM_API_KEY": "k"}, clear=True), \
                mock.patch("sys.stderr", io.StringIO()) as err:
            tier = make_tier(Path(d))
            for f in maya_lane.PACK_FILES:
                (tier / "pack" / f).parent.mkdir(parents=True, exist_ok=True)
                (tier / "pack" / f).write_text("x")
            code = maya_lane.serve_main(["--model-path", str(tier), "--glm-pack", str(tier / "pack"),
                                         "--served-model-name", "lane-id", "--context-length", "4096",
                                         "--ablate", "on", "--ablate-direction", str(Path(d) / "absent.gguf")])
            self.assertEqual(code, 2)
            self.assertIn("--ablate on needs the refusal direction file", err.getvalue())

    def test_config_folder_is_left_unwritable(self):
        with tempfile.TemporaryDirectory() as d:
            path = maya_lane.write_config({"a": 1}, Path(d))
            self.assertEqual(json.loads(path.read_text()), {"a": 1})
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o444)
            self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o555)
            # A second start in the same folder still works.
            self.assertEqual(json.loads(maya_lane.write_config({"a": 2}, Path(d)).read_text()), {"a": 2})
            os.chmod(path.parent, 0o700)

    def test_switches_are_forced_under_both_names_and_debug_settings_removed(self):
        env = {"MAYA_MODEL_MANAGEMENT": "1", "STRATA_UPDATE_CHECK": "1", "MAYA_DEBUG": "1", "STRATA_TURN_TRACE": "1",
               "MAYA_API_KEY": "from-outside", "MAYA_GLM_PREFILL_MB": "4096", "CUDA_CACHE_DISABLE": "0"}
        maya_lane.harden_environment(env)
        self.assertEqual(env["CUDA_CACHE_DISABLE"], "1")       # no kernel cache in the RAM folders
        for name, value in maya_lane.FORCED_ENV.items():
            self.assertEqual(env[name], value)
            self.assertEqual(env[maya_lane.old_name(name)], value)
        for name in maya_lane.REMOVED_ENV:
            self.assertNotIn(name, env)
            self.assertNotIn(maya_lane.old_name(name), env)
        self.assertEqual(env["MAYA_GLM_PREFILL_MB"], "4096")   # engine tuning passes through

    def test_start_is_refused_without_a_key_or_with_a_bad_shape(self):
        argv = ["--served-model-name", "x", "--context-length", "4096", "--engine", "mock"]
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch("sys.stderr", io.StringIO()) as err:
            self.assertEqual(maya_lane.serve_main(argv), 2)
            self.assertIn("VLLM_API_KEY", err.getvalue())
        with mock.patch.dict(os.environ, {"VLLM_API_KEY": "k"}, clear=True), mock.patch("sys.stderr", io.StringIO()) as err:
            self.assertEqual(maya_lane.serve_main(argv + ["--parallel", "9"]), 2)
            self.assertIn("--parallel takes 1 to 8", err.getvalue())
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.dict(os.environ, {"VLLM_API_KEY": "k"}, clear=True), \
                mock.patch("sys.stderr", io.StringIO()) as err:
            tier = make_tier(Path(d))
            code = maya_lane.serve_main(["--model-path", str(tier), "--glm-pack", str(tier / "pack"),
                                         "--served-model-name", "lane-id", "--context-length", "4096"])
            self.assertEqual(code, 2)
            self.assertIn("bash tools/download-weights.sh lane-id", err.getvalue())


class Memory(unittest.TestCase):
    GB = 1 << 20   # kB

    def test_headroom_covers_the_cache_the_lane_cannot_drop(self):
        free = {"MemAvailable": 116 * self.GB, "MemFree": 110 * self.GB}
        self.assertEqual(maya_lane.headroom_for(18, free), 18)           # 6 GB of cache fits the headroom
        busy = {"MemAvailable": 116 * self.GB, "MemFree": 90 * self.GB}
        self.assertEqual(maya_lane.headroom_for(18, busy), 26 + maya_lane.ENGINE_FILES_GB + maya_lane.FREE_AT_READY_GB)
        self.assertEqual(maya_lane.headroom_for(18, {}), 18)             # no figures: the lane's own number
        cfg = maya_lane.build_config(Config().args("--ram-headroom-gb", "18"), Path("/run/maya/log/engine.log"), 29.0)
        self.assertEqual(cfg["env"]["MAYA_GLM_RAM_HEADROOM_GB"], "29")

    def test_meminfo_is_read_in_kb(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "meminfo"
            path.write_text("MemTotal:       127601292 kB\nMemFree:         1300000 kB\nHugePages_Total:       0\nbad line\n")
            self.assertEqual(maya_lane.meminfo(str(path)), {"MemTotal": 127601292, "MemFree": 1300000, "HugePages_Total": 0})
        self.assertEqual(maya_lane.meminfo("/nonexistent/meminfo"), {})

    def test_cached_weights_are_dropped_small_files_and_links_are_not(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "blobs").mkdir()
            big = root / "blobs" / "weights"
            big.write_bytes(b"\0" * maya_lane.CACHED_FILE_MIN_BYTES)
            (root / "blobs" / "config.json").write_text("{}")
            (root / "snapshot").mkdir()
            (root / "snapshot" / "model.gguf").symlink_to(big)
            self.assertEqual(maya_lane.weight_files(root), [str(big)])
            advised = []
            with mock.patch.object(os, "posix_fadvise", lambda fd, off, n, advice: advised.append((off, n, advice))):
                asked = maya_lane.drop_file_cache([str(big), str(root / "snapshot" / "model.gguf"), str(root / "gone")])
            self.assertEqual(asked, 2)                                   # a missing file is passed over
            self.assertEqual(advised, [(0, 0, os.POSIX_FADV_DONTNEED)] * 2)

    def test_a_start_that_ends_short_of_free_memory_is_reported(self):
        self.assertIsNone(maya_lane.low_memory_note({"MemFree": 7 * self.GB, "MemAvailable": 18 * self.GB}))
        self.assertIn("only 1.2 GB is free", maya_lane.low_memory_note({"MemFree": int(1.2 * self.GB)}))
        self.assertIsNone(maya_lane.low_memory_note({}))


class Logging(unittest.TestCase):
    def test_lines_are_kept_until_ready_then_dropped(self):
        out = io.StringIO()
        gate = maya_lane.StdoutGate(out, passthrough=False, keep=3)
        for i in range(5):
            gate.write(f"line {i}\n")
        gate.write("no newline yet")
        self.assertEqual(gate.kept(), ["line 2", "line 3", "line 4", "no newline yet"])
        gate.close()
        gate.write("[maya] done: 12 tokens\n")
        self.assertEqual(gate.kept(), [])
        self.assertEqual(out.getvalue(), "")

    def test_logging_on_passes_everything(self):
        out = io.StringIO()
        gate = maya_lane.StdoutGate(out, passthrough=True)
        gate.write("[maya] done: 12 tokens\n")
        gate.close()
        gate.write("more\n")
        self.assertEqual(out.getvalue(), "[maya] done: 12 tokens\nmore\n")

    def test_a_server_with_an_extra_left_on_is_reported(self):
        server = types.SimpleNamespace(JOBS_DIR=None)
        svc = types.SimpleNamespace(savings=types.SimpleNamespace(path=None), model_management=False, mcp=None, vision=None)
        self.assertEqual(maya_lane.still_on(server, svc), [])
        server.JOBS_DIR = Path("/x/answers")
        svc.savings.path = Path("/x/token-savings.json")
        svc.model_management, svc.mcp, svc.vision = True, object(), object()
        self.assertEqual(len(maya_lane.still_on(server, svc)), 5)


if __name__ == "__main__":
    unittest.main()
