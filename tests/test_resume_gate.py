#!/usr/bin/env python3
"""Approval resume must not bypass the delivery verification gate."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

bridge = None


def setUpModule():
    """Import bridge with an isolated state dir, then restore the caller env."""
    global bridge
    folder = tempfile.mkdtemp(prefix="ao-resume-gate-")
    keys = ("BRIDGE_STATE_DIR", "BRIDGE_STATE", "BRIDGE_PROVIDERS")
    saved = {key: os.environ.get(key) for key in keys}
    os.environ["BRIDGE_STATE_DIR"] = folder
    os.environ["BRIDGE_STATE"] = str(Path(folder) / "bridge-state.json")
    os.environ["BRIDGE_PROVIDERS"] = str(Path(folder) / "providers.json")
    import bridge as bridge_module
    bridge = bridge_module
    for key, value in saved.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value


class ApprovalResumeGateTest(unittest.TestCase):
    def _make_review_task(self, verification):
        store = bridge.MISSION_STORE
        directory = bridge.mission_agent_directory()
        with store.lock:
            created = store.create_mission({
                "title": "Resume gate mission",
                "description": "Verify that approval resume respects delivery checks.",
                "acceptance": "A failed verification cannot be marked done by approval.",
                "autoDiscuss": False,
                "autoRun": False,
            }, directory)
            mission_id = created["id"]
            mission = store.find_mission(mission_id)
            task = mission["tasks"][0]
            task["status"] = "review"
            task["verification"] = verification
            store.set_autorun(mission_id, enabled=True, status="waiting_boss",
                              provider="")
            store._save()
        return mission_id, task["id"]

    def test_failed_verification_blocks_after_approval(self):
        mission_id, task_id = self._make_review_task({"status": "failed"})
        approval = {"missionId": mission_id, "taskId": task_id, "status": "approved"}
        with mock.patch.object(bridge, "start_mission_autorun") as started:
            bridge.resume_mission_after_approval(approval)
            started.assert_not_called()
        store = bridge.MISSION_STORE
        with store.lock:
            _, task = store.find_task(task_id)
            mission = store.find_mission(mission_id)
        self.assertEqual(task["status"], "blocked")
        self.assertIn("验证", task.get("blockedReason", ""))
        self.assertEqual((mission.get("autoRun") or {}).get("status"), "error")

    def test_passed_verification_marks_done(self):
        mission_id, task_id = self._make_review_task({"status": "passed"})
        approval = {"missionId": mission_id, "taskId": task_id, "status": "approved"}
        with mock.patch.object(bridge, "start_mission_autorun") as started:
            bridge.resume_mission_after_approval(approval)
            started.assert_called_once()
        store = bridge.MISSION_STORE
        with store.lock:
            _, task = store.find_task(task_id)
        self.assertEqual(task["status"], "done")

    def test_manual_update_is_local_only_when_remote_token_is_set(self):
        self.assertTrue(bridge.local_client_only("127.0.0.1"))
        self.assertTrue(bridge.local_client_only("::1"))
        original = bridge.BRIDGE_TOKEN
        bridge.BRIDGE_TOKEN = "x" * 32
        try:
            self.assertTrue(bridge.local_client_only("127.0.0.1"))
            self.assertFalse(bridge.local_client_only("10.0.0.8"))
        finally:
            bridge.BRIDGE_TOKEN = original


class ProviderBaseUrlGuardTest(unittest.TestCase):
    def test_base_url_change_requires_confirmation(self):
        with tempfile.TemporaryDirectory() as tmp:
            original_file = bridge.PROVIDERS_FILE
            bridge.PROVIDERS_FILE = Path(tmp) / "providers.json"
            stub = {"text": "OK", "model": "mock", "tokensIn": 1, "tokensOut": 1}
            try:
                with mock.patch.object(bridge, "provider_chat", return_value=stub), \
                        mock.patch.object(bridge, "_first_env", return_value=("", "")):
                    bridge.configure_provider("qwen", {
                        "apiKey": "test-key",
                        "baseUrl": "https://a.example.com/v1",
                        "model": "qwen-plus",
                    })
                    with self.assertRaises(bridge.ProviderCallError) as err:
                        bridge.configure_provider("qwen", {
                            "baseUrl": "https://b.example.com/v1",
                        })
                    self.assertIn("confirmBaseUrlChange", str(err.exception))
                    bridge.configure_provider("qwen", {
                        "baseUrl": "https://b.example.com/v1",
                        "confirmBaseUrlChange": True,
                    })
            finally:
                bridge.PROVIDERS_FILE = original_file

    def test_base_url_change_from_catalog_default_requires_confirmation(self):
        with tempfile.TemporaryDirectory() as tmp:
            original_file = bridge.PROVIDERS_FILE
            bridge.PROVIDERS_FILE = Path(tmp) / "providers.json"
            stub = {"text": "OK", "model": "mock", "tokensIn": 1, "tokensOut": 1}
            try:
                with mock.patch.object(bridge, "provider_chat", return_value=stub), \
                        mock.patch.object(bridge, "_first_env", return_value=("", "")):
                    bridge.configure_provider("qwen", {"apiKey": "test-key"})
                    with self.assertRaises(bridge.ProviderCallError) as err:
                        bridge.configure_provider("qwen", {
                            "baseUrl": "https://relay.example.com/v1",
                        })
                    self.assertIn("confirmBaseUrlChange", str(err.exception))
            finally:
                bridge.PROVIDERS_FILE = original_file
