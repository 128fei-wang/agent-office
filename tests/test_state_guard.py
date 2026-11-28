#!/usr/bin/env python3
"""Corrupt state files must be quarantined, never silently overwritten."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import missions  # noqa: E402


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def clean_env():
    env = {key: value for key, value in os.environ.items()
           if not key.startswith((
               "ANTHROPIC_", "OPENAI_", "DEEPSEEK_", "GEMINI_", "GOOGLE_",
               "MOONSHOT_", "KIMI_", "DASHSCOPE_", "QWEN_", "DOUBAO_",
               "ARK_", "WORKBUDDY_", "OLLAMA_",
           ))}
    return env


class MissionStateGuardTest(unittest.TestCase):
    def test_corrupt_missions_file_is_quarantined(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "missions.json"
            path.write_text("{not-json", encoding="utf-8")
            store = missions.MissionStore(path, Path(tmp) / "uploads")
            self.assertIn("corrupt", store.load_error)
            self.assertEqual(store.data["missions"], [])
            quarantined = list(Path(tmp).glob("missions.json.corrupt-*"))
            self.assertEqual(len(quarantined), 1)
            self.assertEqual(quarantined[0].read_text(encoding="utf-8"), "{not-json")
            if path.exists():
                self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["missions"],
                                 [])

    def test_valid_missions_file_has_no_load_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "missions.json"
            path.write_text(json.dumps({
                "missions": [], "conversations": [], "messages": [],
                "approvals": [], "artifacts": [], "memories": [],
                "modelCalls": [], "next": {"message": 1},
            }), encoding="utf-8")
            store = missions.MissionStore(path, Path(tmp) / "uploads")
            self.assertEqual(store.load_error, "")
            self.assertTrue(path.exists())


class BridgeStateGuardTest(unittest.TestCase):
    def _start(self, folder, corrupt):
        state = Path(folder) / "bridge-state.json"
        if corrupt:
            state.write_text("not-json", encoding="utf-8")
        env = clean_env()
        env.update({
            "BRIDGE_STATE_DIR": str(folder),
            "BRIDGE_STATE": str(state),
            "BRIDGE_PROVIDERS": str(Path(folder) / "providers.json"),
        })
        port = free_port()
        proc = subprocess.Popen(
            [sys.executable, "-I", str(ROOT / "bridge.py"), "--port", str(port)],
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )

        def stop():
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()

        self.addCleanup(stop)
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(
                        "http://127.0.0.1:%d/health" % port, timeout=1) as response:
                    return json.loads(response.read().decode("utf-8"))
            except Exception:
                time.sleep(0.1)
        self.fail("bridge did not start")

    def test_corrupt_bridge_state_is_quarantined(self):
        with tempfile.TemporaryDirectory() as tmp:
            health = self._start(tmp, corrupt=True)
            self.assertIn("corrupt", health.get("stateError", ""))
            quarantined = list(Path(tmp).glob("bridge-state.json.corrupt-*"))
            self.assertEqual(len(quarantined), 1)
            self.assertEqual(quarantined[0].read_text(encoding="utf-8"), "not-json")
            self.assertFalse((Path(tmp) / "bridge-state.json").exists())

    def test_healthy_bridge_state_reports_no_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            health = self._start(tmp, corrupt=False)
            self.assertEqual(health.get("stateError", ""), "")
            self.assertEqual(health.get("missionsError", ""), "")
