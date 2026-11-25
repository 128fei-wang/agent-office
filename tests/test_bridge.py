#!/usr/bin/env python3
"""Integration tests for the local bridge. Standard library only.

Run with:
    python3 -m unittest discover -s tests -v
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRIDGE = ROOT / "bridge.py"


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class MockProviderHandler(BaseHTTPRequestHandler):
    seen = []

    def log_message(self, fmt, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except ValueError:
            payload = {}
        MockProviderHandler.seen.append({
            "path": self.path,
            "authorization": self.headers.get("Authorization"),
            "x-api-key": self.headers.get("x-api-key"),
            "x-goog-api-key": self.headers.get("x-goog-api-key"),
            "payload": payload,
        })
        if self.path.endswith("/chat/completions"):
            data = {
                "choices": [{"message": {"content": "OK from openai"}}],
                "usage": {"prompt_tokens": 7, "completion_tokens": 2},
            }
        elif self.path.endswith("/messages"):
            data = {
                "content": [{"type": "text", "text": "OK from anthropic"}],
                "usage": {"input_tokens": 5, "output_tokens": 2},
            }
        elif ":generateContent" in self.path:
            data = {
                "candidates": [{"content": {"parts": [{"text": "OK from gemini"}]}}],
                "usageMetadata": {"promptTokenCount": 6, "candidatesTokenCount": 2},
            }
        else:
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps(data).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class BridgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.port = free_port()
        cls.base = "http://127.0.0.1:%d" % cls.port
        cls.mock = ThreadingHTTPServer(("127.0.0.1", 0), MockProviderHandler)
        cls.mock_port = cls.mock.server_address[1]
        threading.Thread(target=cls.mock.serve_forever, daemon=True).start()
        providers = {
            "deepseek": {
                "apiKey": "test-openai",
                "baseUrl": "http://127.0.0.1:%d/v1" % cls.mock_port,
                "model": "mock-openai",
            },
            "gemini": {
                "apiKey": "test-gemini",
                "baseUrl": "http://127.0.0.1:%d/v1beta" % cls.mock_port,
                "model": "mock-gemini",
            },
            "anthropic": {
                "apiKey": "test-anthropic",
                "baseUrl": "http://127.0.0.1:%d/v1" % cls.mock_port,
                "model": "mock-claude",
            },
        }
        providers_path = Path(cls.tmp.name) / "providers.json"
        providers_path.write_text(json.dumps(providers), "utf-8")
        env = os.environ.copy()
        env["BRIDGE_STATE"] = str(Path(cls.tmp.name) / "bridge-state.json")
        env["BRIDGE_PROVIDERS"] = str(providers_path)
        cls.proc = subprocess.Popen(
            [sys.executable, "-I", str(BRIDGE), "--port", str(cls.port)],
            cwd=cls.tmp.name,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 8
        while time.time() < deadline:
            try:
                status, _ = cls.request("/health")
                if status == 200:
                    return
            except (urllib.error.URLError, ConnectionError, OSError):
                pass
            time.sleep(0.1)
        cls.proc.terminate()
        raise RuntimeError("bridge did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.proc.kill()
        cls.mock.shutdown()
        cls.mock.server_close()
        cls.tmp.cleanup()

    @classmethod
    def request(cls, path, method="GET", body=None, headers=None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            cls.base + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                raw = res.read().decode("utf-8")
                return res.status, json.loads(raw) if raw.startswith(("{", "[")) else raw
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8")
            return exc.code, json.loads(raw) if raw.startswith(("{", "[")) else raw

    def make_pair(self):
        status, data = self.request("/pair/code", "POST", {})
        self.assertEqual(status, 200)
        return data["pair"]

    def test_health(self):
        status, data = self.request("/health")
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        self.assertEqual(data["service"], "agent-office-bridge")

    def test_pair_claim_is_one_time_and_greets(self):
        pair = self.make_pair()
        self.assertEqual(len(pair["code"]), 8)
        status, setup = self.request("/pair/%s/setup.md" % pair["code"])
        self.assertEqual(status, 200)
        self.assertIn(pair["code"], setup)
        self.assertIn("/claim", setup)

        status, claimed = self.request(
            "/pair/%s/claim" % pair["code"],
            "POST",
            {"name": "Test Agent", "runtime": "test", "skills": ["edit"]},
        )
        self.assertEqual(status, 200)
        self.assertTrue(claimed["ok"])
        self.assertTrue(claimed["agent"]["id"].startswith("ext-"))
        self.assertEqual(claimed["greeting"]["kind"], "hello")

        status, again = self.request("/pair/%s/claim" % pair["code"], "POST", {"name": "Again"})
        self.assertEqual(status, 409)

        status, events = self.request("/events?since=0")
        self.assertEqual(status, 200)
        self.assertTrue(any(e["kind"] == "hello" for e in events["events"]))

    def test_claim_cannot_take_over_supplied_id(self):
        pair = self.make_pair()
        status, data = self.request(
            "/pair/%s/claim" % pair["code"],
            "POST",
            {"id": "ext-demo-claude", "name": "Impostor", "runtime": "test"},
        )
        self.assertEqual(status, 200)
        self.assertNotEqual(data["agent"]["id"], "ext-demo-claude")

    def test_cancel_pending_pair(self):
        pair = self.make_pair()
        status, _ = self.request("/pair/%s" % pair["code"], "DELETE")
        self.assertEqual(status, 200)
        status, _ = self.request("/pair/%s" % pair["code"])
        self.assertEqual(status, 404)

    def test_cannot_cancel_claimed_pair(self):
        pair = self.make_pair()
        status, _ = self.request("/pair/%s/claim" % pair["code"], "POST", {"name": "Owned"})
        self.assertEqual(status, 200)
        status, _ = self.request("/pair/%s" % pair["code"], "DELETE")
        self.assertEqual(status, 409)

    def test_all_pending_codes_are_returned(self):
        codes = [self.make_pair()["code"] for _ in range(14)]
        status, data = self.request("/pairs")
        self.assertEqual(status, 200)
        live = {p["code"] for p in data["pairs"] if p["status"] == "pending"}
        self.assertTrue(set(codes).issubset(live))

    def test_rejects_non_local_origin_and_host(self):
        status, _ = self.request("/health", headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 403)

        status, data = self.request("/health", headers={"Origin": "http://127.0.0.1:5173"})
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])

        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.request("GET", "/health", headers={"Host": "evil.example"})
            res = conn.getresponse()
            self.assertEqual(res.status, 403)
            res.read()
        finally:
            conn.close()

    def test_provider_catalog_hides_keys(self):
        status, data = self.request("/providers")
        self.assertEqual(status, 200)
        ids = {p["id"] for p in data["providers"]}
        self.assertTrue({"doubao", "deepseek", "workbuddy", "gemini", "openai",
                         "anthropic", "kimi", "qwen", "ollama"}.issubset(ids))
        deepseek = next(p for p in data["providers"] if p["id"] == "deepseek")
        self.assertTrue(deepseek["configured"])
        doubao = next(p for p in data["providers"] if p["id"] == "doubao")
        self.assertFalse(doubao["configured"])
        self.assertNotIn("test-openai", json.dumps(data))
        self.assertNotIn("apiKey", json.dumps(data))
        status, detail = self.request("/providers/deepseek")
        self.assertEqual(status, 200)
        self.assertEqual(detail["provider"]["id"], "deepseek")
        self.assertNotIn("apiKey", json.dumps(detail))
        status, _ = self.request("/providers/nope")
        self.assertEqual(status, 404)

    def test_provider_openai_connect_and_run(self):
        status, data = self.request("/providers/deepseek/connect", "POST", {})
        self.assertEqual(status, 200)
        self.assertEqual(data["agent"]["id"], "ext-deepseek")
        self.assertTrue(data["created"])
        status, data = self.request("/providers/deepseek/connect", "POST", {})
        self.assertEqual(status, 200)
        self.assertFalse(data["created"])

        status, data = self.request("/providers/deepseek/test", "POST", {})
        self.assertEqual(status, 200)
        self.assertEqual(data["text"], "OK from openai")
        self.assertEqual(data["model"], "mock-openai")
        self.assertEqual(data["tokensIn"], 7)

        status, data = self.request("/providers/deepseek/run", "POST", {"prompt": "hello"})
        self.assertEqual(status, 200)
        self.assertEqual(data["event"]["provider"], "deepseek")
        self.assertEqual(data["event"]["model"], "mock-openai")
        self.assertEqual(data["event"]["tokensOut"], 2)

        status, agents = self.request("/agents")
        self.assertTrue(any(a["id"] == "ext-deepseek" and a.get("provider") == "deepseek"
                            for a in agents["agents"]))
        auth = [item["authorization"] for item in MockProviderHandler.seen
                if item["path"].endswith("/chat/completions")]
        self.assertIn("Bearer test-openai", auth)

    def test_provider_gemini_protocol(self):
        status, data = self.request("/providers/gemini/test", "POST", {})
        self.assertEqual(status, 200)
        self.assertEqual(data["text"], "OK from gemini")
        seen = [item for item in MockProviderHandler.seen if ":generateContent" in item["path"]]
        self.assertTrue(seen)
        self.assertEqual(seen[-1]["x-goog-api-key"], "test-gemini")

    def test_provider_anthropic_protocol(self):
        status, data = self.request("/providers/anthropic/test", "POST", {})
        self.assertEqual(status, 200)
        self.assertEqual(data["text"], "OK from anthropic")
        seen = [item for item in MockProviderHandler.seen if item["path"].endswith("/messages")]
        self.assertTrue(seen)
        self.assertEqual(seen[-1]["x-api-key"], "test-anthropic")

    def test_provider_missing_key_returns_409(self):
        status, data = self.request("/providers/doubao/test", "POST", {})
        self.assertEqual(status, 409)
        self.assertEqual(data["code"], "provider_not_configured")

    def test_assignment_delegation_and_writeback(self):
        status, agent = self.request("/agents", "POST", {
            "id": "ext-test-assign", "name": "Test Assignee", "runtime": "http",
            "skills": ["edit"]
        })
        self.assertEqual(status, 200)
        status, data = self.request("/assignments", "POST", {
            "agentId": "ext-test-assign", "taskId": "t-test-1",
            "title": "Delegate the staging check", "scenarioId": "launch",
            "runId": "run-test", "brief": "Run the staging verification."
        })
        self.assertEqual(status, 200)
        assignment = data["assignment"]
        self.assertEqual(assignment["status"], "assigned")
        self.assertEqual(assignment["progress"], 0)
        self.assertEqual(assignment["agentName"], "Test Assignee")
        assignment_id = assignment["id"]
        self.assertTrue(assignment_id.startswith("asg-"))

        status, listed = self.request("/assignments?agentId=ext-test-assign")
        self.assertEqual(status, 200)
        self.assertTrue(any(a["id"] == assignment_id for a in listed["assignments"]))

        status, data = self.request("/assignments/" + assignment_id, "PATCH", {
            "status": "in_progress", "progress": 40, "result": "halfway"
        })
        self.assertEqual(status, 200)
        self.assertEqual(data["assignment"]["status"], "in_progress")
        self.assertEqual(data["assignment"]["progress"], 40)

        status, data = self.request("/assignments/" + assignment_id, "PATCH", {
            "status": "completed", "progress": 100, "result": "verified",
            "evidence": ["tests/12-passed", "run://staging"]
        })
        self.assertEqual(status, 200)
        self.assertEqual(data["assignment"]["status"], "completed")
        self.assertEqual(data["assignment"]["progress"], 100)
        self.assertTrue(data["assignment"]["completedAt"])
        self.assertEqual(data["assignment"]["evidence"], ["tests/12-passed", "run://staging"])

        status, data = self.request("/assignments/" + assignment_id, "PATCH", {
            "status": "failed"
        })
        self.assertEqual(status, 400)

        status, events = self.request("/events?since=0")
        self.assertEqual(status, 200)
        kinds = [e["kind"] for e in events["events"] if e.get("taskId") == "t-test-1"]
        self.assertIn("handoff", kinds)
        self.assertIn("complete", kinds)

    def test_assignment_validation_and_cancel(self):
        status, _ = self.request("/assignments", "POST", {
            "agentId": "ext-missing", "taskId": "t-x", "title": "x"
        })
        self.assertEqual(status, 400)
        status, _ = self.request("/assignments", "POST", {
            "agentId": "ext-test-assign", "taskId": "t-x"
        })
        self.assertEqual(status, 400)

        status, agent = self.request("/agents", "POST", {
            "id": "ext-test-cancel", "name": "Cancel Assignee", "runtime": "http"
        })
        self.assertEqual(status, 200)
        status, data = self.request("/assignments", "POST", {
            "agentId": "ext-test-cancel", "taskId": "t-test-2",
            "title": "Cancel me", "scenarioId": "launch"
        })
        self.assertEqual(status, 200)
        assignment_id = data["assignment"]["id"]
        status, data = self.request("/assignments/" + assignment_id, "DELETE")
        self.assertEqual(status, 200)
        self.assertEqual(data["assignment"]["status"], "cancelled")
        status, _ = self.request("/assignments/unknown-id", "PATCH", {"progress": 10})
        self.assertEqual(status, 400)

    def test_missing_agent_event_is_rejected(self):
        status, data = self.request("/events", "POST", {"agentId": "ext-missing", "kind": "skill"})
        self.assertEqual(status, 400)
        self.assertIn("unknown agentId", data["error"])


if __name__ == "__main__":
    unittest.main()
