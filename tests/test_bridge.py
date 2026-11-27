#!/usr/bin/env python3
"""Integration tests for the local bridge. Standard library only.

Run with:
    python3 -m unittest discover -s tests -v
"""
import io
import json
import os
import zipfile
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
    flaky_until = None

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.path.startswith("/update/latest"):
            data = {
                "tag_name": "v9.9.9",
                "name": "Agent Office v9.9.9",
                "body": "Mock release for bridge tests.",
                "html_url": "https://example.test/releases/v9.9.9",
                "tarball_url": "http://127.0.0.1:%d/update/tarball" % self.server.server_address[1],
                "published_at": "2026-11-25T00:00:00Z",
            }
            body = json.dumps(data).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

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
        prompt_text = json.dumps(payload, ensure_ascii=False)
        if "SLOW_TEST" in prompt_text:
            time.sleep(0.35)
        if "FLAKY_ONCE" in prompt_text:
            now = time.time()
            if MockProviderHandler.flaky_until is None:
                MockProviderHandler.flaky_until = now + 1.0
            if now < MockProviderHandler.flaky_until:
                body = json.dumps({"error": "transient mock failure"}).encode("utf-8")
                self.send_response(503)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
        mission_report = "deliverable" in prompt_text
        placeholder_report = "PLACEHOLDER_DELIVERABLE" in prompt_text
        incomplete_report = "INCOMPLETE_REPORT" in prompt_text
        needs_approval = "NEEDS_APPROVAL" in prompt_text and "任务：需求边界与验收" in prompt_text
        invalid_gate = "INVALID_GATE" in prompt_text and not needs_approval
        if placeholder_report:
            report_text = json.dumps({
                "summary": "已完成任务并提交交付物。",
                "done": ["完成主要工作"],
                "next": ["按验收标准复核交付物"],
                "risks": ["未发现新增风险"],
                "solution": "已按验收标准完成。",
                "evidence": ["任务执行报告"],
                "deliverable": "已完成任务并提交交付物。",
                "needsBoss": [],
            }, ensure_ascii=False)
        elif incomplete_report:
            report_text = json.dumps({
                "summary": "Partial mock report",
                "deliverable": "# Partial deliverable\n\nThis repaired partial report still contains a concrete, usable deliverable with implementation notes and verification steps so the quality gate can evaluate the repair path instead of treating it as a placeholder.",
            }, ensure_ascii=False)
        else:
            report_text = json.dumps({
            "summary": "Mock agent report", "done": ["mock step"],
            "next": ["review"], "risks": ["mock risk"],
            "solution": "mock fallback and verification", "evidence": ["mock"],
            "deliverable": "# Mock deliverable\n\nThis is a test artifact with enough concrete content to pass the usable-deliverable gate. It includes the implementation notes, verification steps and the exact files a reviewer should check before accepting the task.",
            "needsBoss": ["spend"] if needs_approval else (["technical"] if invalid_gate else []),
            "approval": ({
                "type": "spend", "title": "Mock spend approval",
                "description": "Approve a small test spend.", "amount": 10,
                "currency": "CNY"
            } if needs_approval else None),
        }, ensure_ascii=False)
        if self.path.endswith("/chat/completions"):
            data = {
                "choices": [{"message": {"content": report_text if mission_report else "OK from openai"}}],
                "usage": {"prompt_tokens": 7, "completion_tokens": 2},
            }
        elif self.path.endswith("/messages"):
            data = {
                "content": [{"type": "text", "text": report_text if mission_report else "OK from anthropic"}],
                "usage": {"input_tokens": 5, "output_tokens": 2},
            }
        elif ":generateContent" in self.path:
            data = {
                "candidates": [{"content": {"parts": [
                    {"text": report_text if mission_report else "OK from gemini"}]}}],
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
        cls.providers_path = providers_path
        cls.providers_original = providers_path.read_text("utf-8")
        env = {
            key: value for key, value in os.environ.items()
            if not key.startswith((
                "ANTHROPIC_", "OPENAI_", "DEEPSEEK_", "GEMINI_", "GOOGLE_",
                "MOONSHOT_", "KIMI_", "DASHSCOPE_", "QWEN_", "DOUBAO_",
                "ARK_", "WORKBUDDY_", "OLLAMA_",
            ))
        }
        # Isolated environment credentials for the detection/configure flow.
        env["MOONSHOT_API_KEY"] = "test-env-kimi"
        env["AGENT_OFFICE_KIMI_BASE_URL"] = "http://127.0.0.1:%d/v1" % cls.mock_port
        env["AGENT_OFFICE_KIMI_MODEL"] = "mock-kimi-env"
        env["BRIDGE_STATE_DIR"] = cls.tmp.name
        env["BRIDGE_STATE"] = str(Path(cls.tmp.name) / "bridge-state.json")
        env["BRIDGE_PROVIDERS"] = str(providers_path)
        env["AGENT_OFFICE_UPDATE_API"] = (
            "http://127.0.0.1:%d/update/latest" % cls.mock_port
        )
        env["AGENT_OFFICE_UPDATE_MODE"] = "archive"
        cls.proc = subprocess.Popen(
            [sys.executable, "-I", str(BRIDGE), "--port", str(cls.port)],
            cwd=cls.tmp.name,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 45
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
    def request(cls, path, method="GET", body=None, headers=None, timeout=15):
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            cls.base + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                raw = res.read().decode("utf-8")
                return res.status, json.loads(raw) if raw.startswith(("{", "[")) else raw
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8")
            return exc.code, json.loads(raw) if raw.startswith(("{", "[")) else raw

    @classmethod
    def raw_request(cls, path, body, headers=None):
        req = urllib.request.Request(
            cls.base + path, data=body, method="POST",
            headers={"Content-Type": "application/octet-stream", **(headers or {})},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
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
        self.assertTrue(data["version"])
        self.assertTrue(data["bootId"])

    def test_mission_workspace_flow(self):
        status, recommendation = self.request("/missions/recommend", "POST", {
            "title": "Recommendation",
            "description": "Build a tested landing page with copy, design, code and QA.",
            "acceptance": "Recommendation includes concrete executors.",
        })
        self.assertEqual(status, 200, recommendation)
        self.assertTrue(recommendation["tasks"])
        self.assertTrue(recommendation["suggestedMemberIds"])
        self.assertTrue(recommendation["preferredExecutors"])
        self.assertTrue(all(t["estimate"]["tokens"] > 0 for t in recommendation["tasks"]))

        status, data = self.request("/missions", "POST", {
            "title": "Bridge mission test",
            "description": "Build a tested landing page with copy, design, code and QA.",
            "acceptance": "Landing page works and tests pass.",
            "autoDiscuss": False,
        })
        self.assertEqual(status, 201, data)
        mission = data["mission"]
        self.assertTrue(mission["conversationId"])
        self.assertGreaterEqual(len(mission["tasks"]), 4)
        self.assertTrue(mission["coverage"]["noIdle"])
        member = mission["members"][0]

        status, overview = self.request("/missions/overview")
        self.assertEqual(status, 200)
        self.assertTrue(any(m["id"] == mission["id"] for m in overview["missions"]))

        status, msg = self.request(
            "/conversations/%s/messages" % mission["conversationId"], "POST",
            {"senderId": "boss", "senderType": "boss", "text": "bridge chat"},
        )
        self.assertEqual(status, 201)
        self.assertEqual(msg["message"]["text"], "bridge chat")

        status, upload = self.raw_request(
            "/files", b"# bridge document\n",
            {"X-Filename": "bridge.md", "X-Mime": "text/markdown",
             "X-Mission-Id": mission["id"],
             "X-Conversation-Id": mission["conversationId"]},
        )
        self.assertEqual(status, 200, upload)
        artifact = upload["artifact"]
        self.assertIn("bridge document", artifact["extractedText"])
        status, attached = self.request(
            "/conversations/%s/messages" % mission["conversationId"], "POST",
            {"senderId": "boss", "senderType": "boss", "text": "attachment",
             "attachmentIds": [artifact["id"]]},
        )
        self.assertEqual(status, 201)
        self.assertEqual(attached["message"]["attachments"][0]["name"], "bridge.md")
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.request("GET", "/files/%s/raw" % artifact["id"])
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            self.assertIn(b"bridge document", res.read())
        finally:
            conn.close()

        status, error = self.request(
            "/conversations/%s/messages" % mission["conversationId"], "POST",
            {"senderId": member["id"], "senderType": "agent", "type": "report",
             "report": {"summary": "x", "done": [], "next": ["y"], "risks": ["z"],
                        "solution": ""}},
        )
        self.assertEqual(status, 400)
        self.assertEqual(error["code"], "report_needs_solution")

        status, report = self.request(
            "/conversations/%s/messages" % mission["conversationId"], "POST",
            {"senderId": member["id"], "senderType": "agent", "type": "report",
             "report": {"summary": "need budget", "done": ["r"], "next": ["buy"],
                        "risks": ["cost"], "solution": "buy smallest first",
                        "needsBoss": ["spend"],
                        "approval": {"type": "spend", "title": "Bridge spend",
                                     "amount": 10}}},
        )
        self.assertEqual(status, 201)
        status, approvals = self.request("/approvals?status=pending")
        approval = next(a for a in approvals["approvals"] if a["title"] == "Bridge spend")
        status, resolved = self.request(
            "/approvals/%s/resolve" % approval["id"], "POST",
            {"decision": "approved", "note": "ok"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(resolved["approval"]["status"], "approved")

        status, direct = self.request("/conversations", "POST", {
            "kind": "direct", "memberIds": [member["id"]],
        })
        self.assertEqual(status, 201)
        direct_id = direct["conversation"]["id"]
        status, _ = self.request(
            "/conversations/%s/messages" % direct_id, "POST",
            {"senderId": "boss", "senderType": "boss", "type": "text",
             "text": "用一句话介绍你能做什么。"},
        )
        self.assertEqual(status, 201)
        reply = None
        deadline = time.time() + 45
        while time.time() < deadline:
            _, listing = self.request("/conversations/%s/messages?since=0" % direct_id)
            reply = next((m for m in listing["messages"]
                          if m.get("senderType") == "agent"
                          and (m.get("meta") or {}).get("chatReply")), None)
            if reply:
                break
            time.sleep(0.15)
        self.assertIsNotNone(reply, "direct chat agent reply")
        self.assertTrue(reply.get("text"))
        status, _ = self.request("/conversations/%s" % direct_id, "DELETE")
        self.assertEqual(status, 200)
        group_ids = [m["id"] for m in mission["members"][:2]]
        if len(group_ids) >= 2:
            status, group = self.request("/conversations", "POST", {
                "kind": "group", "memberIds": group_ids,
            })
            self.assertEqual(status, 201)
            group_id = group["conversation"]["id"]
            status, _ = self.request(
                "/conversations/%s/messages" % group_id, "POST",
                {"senderId": "boss", "senderType": "boss", "type": "text",
                 "text": "大家好，各自用一句话说明能负责什么。"},
            )
            self.assertEqual(status, 201)
            group_reply = None
            deadline = time.time() + 45
            while time.time() < deadline:
                _, listing = self.request("/conversations/%s/messages?since=0" % group_id)
                group_reply = next((m for m in listing["messages"]
                                    if m.get("senderType") == "agent"
                                    and (m.get("meta") or {}).get("chatReply")), None)
                if group_reply:
                    break
                time.sleep(0.15)
            self.assertIsNotNone(group_reply, "group chat agent reply")
            status, _ = self.request("/conversations/%s" % group_id, "DELETE")
            self.assertEqual(status, 200)
        status, _ = self.request("/missions/%s" % mission["id"], "DELETE")
        self.assertEqual(status, 200)

    def test_memory_api_and_search(self):
        status, created = self.request("/memories", "POST", {
            "title": "Rollback drill",
            "text": "Always rehearse a rollback before a public launch.",
            "scope": "workspace",
            "tags": ["launch", "risk"],
            "pinned": True,
        })
        self.assertEqual(status, 201)
        memory_id = created["memory"]["id"]
        status, listing = self.request("/memories")
        self.assertEqual(status, 200)
        self.assertTrue(any(row["id"] == memory_id for row in listing["memories"]))
        status, found = self.request("/search?q=" + urllib.parse.quote("rollback"))
        self.assertEqual(status, 200)
        self.assertTrue(any(row["id"] == memory_id for row in found["memories"]))
        status, updated = self.request("/memories/" + memory_id, "PATCH", {
            "title": "Rollback drill v2", "pinned": False
        })
        self.assertEqual(status, 200)
        self.assertEqual(updated["memory"]["title"], "Rollback drill v2")
        self.assertEqual(self.request("/memories/" + memory_id, "DELETE")[0], 200)

    def test_conversation_unread_pin_mute_and_rename(self):
        status, directory = self.request("/missions/agents")
        self.assertEqual(status, 200)
        members = [a["id"] for a in directory["agents"][:2]]
        self.assertGreaterEqual(len(members), 2)
        status, created = self.request("/conversations", "POST", {
            "kind": "group", "title": "Chat metadata", "memberIds": members,
        })
        self.assertEqual(status, 201, created)
        conversation = created["conversation"]
        self.assertFalse(conversation["pinned"])
        self.assertFalse(conversation["muted"])
        self.assertEqual(conversation["unreadCount"], 0)
        self.assertEqual(conversation["readSeq"], 0)
        status, boss = self.request(
            "/conversations/%s/messages" % conversation["id"], "POST",
            {"senderId": "boss", "senderType": "boss", "type": "text", "text": "hello"},
        )
        self.assertEqual(status, 201, boss)
        after_boss = self.request("/conversations/%s" % conversation["id"])[1]["conversation"]
        self.assertEqual(after_boss["readSeq"], boss["message"]["seq"])
        self.assertEqual(after_boss["unreadCount"], 0)
        status, reply = self.request(
            "/conversations/%s/messages" % conversation["id"], "POST",
            {"senderId": members[0], "senderType": "agent", "type": "text", "text": "reply"},
        )
        self.assertEqual(status, 201, reply)
        after_reply = self.request("/conversations/%s" % conversation["id"])[1]["conversation"]
        self.assertEqual(after_reply["unreadCount"], 1)
        self.assertEqual(after_reply["lastSeq"], reply["message"]["seq"])
        status, patched = self.request(
            "/conversations/%s" % conversation["id"], "PATCH",
            {"title": "Renamed room", "pinned": True, "muted": True,
             "readSeq": reply["message"]["seq"]},
        )
        self.assertEqual(status, 200, patched)
        row = patched["conversation"]
        self.assertEqual(row["title"], "Renamed room")
        self.assertTrue(row["pinned"])
        self.assertTrue(row["muted"])
        self.assertEqual(row["unreadCount"], 0)
        status, bad = self.request(
            "/conversations/%s" % conversation["id"], "PATCH", {"readSeq": "nope"})
        self.assertEqual(status, 400, bad)
        self.request("/conversations/%s" % conversation["id"], "DELETE")

    def test_mission_group_chat_replies_during_active_autorun(self):
        status, data = self.request("/missions", "POST", {
            "title": "Active chat auto mission",
            "description": "SLOW_TEST: build and verify a landing page with QA.",
            "acceptance": "The mission group still answers the boss while auto-run is active.",
            "autoDiscuss": False,
            "autoRun": True,
        })
        self.assertEqual(status, 201, data)
        mission = data["mission"]
        mission_id = mission["id"]
        conversation_id = mission["conversationId"]
        active = ("queued", "discussing", "running", "waiting_boss")
        auto_status = ""
        deadline = time.time() + 15
        while time.time() < deadline:
            _, detail = self.request("/missions/%s" % mission_id)
            auto_status = ((detail.get("mission") or {}).get("autoRun") or {}).get("status") or ""
            if auto_status in active or auto_status in ("done", "error", "stopped"):
                break
            time.sleep(0.1)
        self.assertIn(auto_status, active, detail)
        status, sent = self.request(
            "/conversations/%s/messages" % conversation_id, "POST",
            {"senderId": "boss", "senderType": "boss", "type": "text",
             "text": "执行中收到请回复一句进度。"},
        )
        self.assertEqual(status, 201, sent)
        reply = None
        deadline = time.time() + 45
        while time.time() < deadline:
            _, listing = self.request("/conversations/%s/messages?since=0" % conversation_id)
            reply = next((m for m in listing["messages"]
                          if m.get("senderType") == "agent"
                          and (m.get("meta") or {}).get("chatReply")), None)
            if reply:
                break
            time.sleep(0.2)
        self.assertIsNotNone(reply, "mission group agent reply during auto-run")
        self.assertTrue(reply.get("text"))
        self.request("/missions/%s/autorun/stop" % mission_id, "POST", {})
        time.sleep(0.5)
        self.request("/missions/%s" % mission_id, "DELETE")

    def test_mcp_server_protocol(self):
        status, init = self.request("/mcp", "POST", {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                       "clientInfo": {"name": "test", "version": "1"}},
        })
        self.assertEqual(status, 200, init)
        self.assertEqual(init["result"]["serverInfo"]["name"], "agent-office")
        status, tools = self.request("/mcp", "POST", {
            "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {},
        })
        self.assertEqual(status, 200, tools)
        self.assertGreaterEqual(len(tools["result"]["tools"]), 5)
        self.assertIn("agent_office_list_tasks",
                      [tool["name"] for tool in tools["result"]["tools"]])

        self.request("/agents", "POST", {
            "id": "ext-mcp-test", "name": "MCP Test", "runtime": "mcp",
            "skills": ["mcp"], "role": "operator",
        })
        status, result = self.request("/mcp", "POST", {
            "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": {"name": "agent_office_list_tasks", "arguments": {}},
        }, headers={"X-Agent-Id": "ext-mcp-test"})
        self.assertEqual(status, 200, result)
        self.assertFalse(result["result"]["isError"])
        self.assertIn("tasks", result["result"]["content"][0]["text"])
        status, bad = self.request("/mcp", "POST", {
            "jsonrpc": "2.0", "id": 4, "method": "tools/call",
            "params": {"name": "agent_office_list_tasks", "arguments": {}},
        })
        self.assertEqual(status, 200)
        self.assertTrue(bad["result"]["isError"])
        self.request("/agents/ext-mcp-test", "DELETE")

    def test_external_agent_role_and_avatar(self):
        status, meta = self.request("/agents")
        self.assertEqual(status, 200)
        self.assertTrue(meta["meta"]["roles"])
        self.assertTrue(meta["meta"]["avatars"])

        status, data = self.request("/agents", "POST", {
            "id": "ext-role-test", "name": "Role Test", "runtime": "test",
            "skills": ["research"], "role": "qa", "avatar": "fox",
        })
        self.assertEqual(status, 200, data)
        self.assertEqual(data["agent"]["role"], "qa")
        self.assertEqual(data["agent"]["logoText"], "🦊")

        status, data = self.request("/agents/ext-role-test", "PATCH", {
            "role": "design", "avatar": "custom", "avatarText": "Z9",
            "avatarColor": "#123456",
        })
        self.assertEqual(status, 200, data)
        self.assertEqual(data["agent"]["role"], "design")
        self.assertEqual(data["agent"]["logoText"], "Z9")
        status, directory = self.request("/missions/agents")
        row = next(a for a in directory["agents"] if a["id"] == "ext-role-test")
        self.assertEqual(row["role"], "design")
        self.assertEqual(row["logoText"], "Z9")
        self.assertEqual(row["logoColor"], "#123456")

        status, invalid = self.request("/agents/ext-role-test", "PATCH", {"role": "wizard"})
        self.assertEqual(status, 400)
        status, recommendation = self.request("/missions/recommend", "POST", {
            "description": "Design a landing page and run QA.",
            "acceptance": "Design and QA are covered.",
        })
        self.assertEqual(status, 200, recommendation)
        self.assertEqual(recommendation["scope"], "external")
        self.assertIn("ext-role-test", recommendation["suggestedMemberIds"])
        self.assertTrue(any(agent["id"] == "ext-role-test"
                            for task in recommendation["tasks"]
                            for agent in task["recommended"]))
        self.request("/agents/ext-role-test", "DELETE")

    def test_mission_ai_task_run(self):
        status, data = self.request("/missions", "POST", {
            "title": "AI run mission",
            "description": "Produce a concrete plan and a deliverable for a landing page.",
            "acceptance": "A report and a Markdown deliverable are stored.",
            "autoDiscuss": False,
        })
        self.assertEqual(status, 201, data)
        mission = data["mission"]
        task = next(t for t in mission["tasks"] if t["status"] == "assigned")
        status, result = self.request(
            "/missions/%s/tasks/%s/run" % (mission["id"], task["id"]), "POST", {})
        self.assertEqual(status, 200, result)
        self.assertEqual(result["task"]["status"], "review")
        self.assertTrue(result["artifact"]["extractedText"])
        self.assertIn("Mock deliverable", result["artifact"]["extractedText"])
        self.assertTrue(result["provider"])
        self.assertGreater(result["usage"]["tokensIn"], 0)
        self.assertGreater(result["task"]["actual"]["tokens"], 0)
        messages = self.request(
            "/conversations/%s/messages" % mission["conversationId"])[1]["messages"]
        self.assertTrue(any(m["type"] == "report" and m.get("usage", {}).get("tokensIn", 0) > 0
                            for m in messages))
        self.request("/missions/%s" % mission["id"], "DELETE")

    def test_mission_autorun_rejects_placeholder_deliverable(self):
        status, data = self.request("/missions", "POST", {
            "title": "Placeholder delivery guard",
            "description": "PLACEHOLDER_DELIVERABLE: produce a concrete deliverable.",
            "acceptance": "The task must not be marked done without a usable artifact.",
            "autoDiscuss": False,
            "autoRun": True,
        })
        self.assertEqual(status, 201, data)
        mission_id = data["mission"]["id"]
        deadline = time.time() + 30
        latest = data["mission"]
        while time.time() < deadline:
            latest = self.request("/missions/" + mission_id)[1]["mission"]
            if (latest.get("autoRun") or {}).get("status") in ("error", "stopped", "done"):
                break
            time.sleep(0.2)
        auto = latest.get("autoRun") or {}
        self.assertEqual(auto.get("status"), "error", latest)
        self.assertIn("交付物", auto.get("error", ""))
        self.assertFalse(all(t.get("status") == "done" for t in latest.get("tasks", [])))
        self.assertFalse(any(int(a.get("size") or 0) < 80 for a in latest.get("artifacts", [])))
        latest = self.request("/missions/" + mission_id)[1]["mission"]
        self.assertFalse(any(t.get("status") == "done" for t in latest.get("tasks", [])))
        self.request("/missions/" + mission_id, "DELETE")

    def test_mission_deliverables_zip(self):
        status, data = self.request("/missions", "POST", {
            "title": "Zip delivery mission",
            "description": "Produce a concrete deliverable and package it for download.",
            "acceptance": "The deliverable can be downloaded as a ZIP with a manifest.",
            "autoDiscuss": False,
        })
        self.assertEqual(status, 201, data)
        mission = data["mission"]
        task = next(t for t in mission["tasks"] if t["status"] == "assigned")
        self.assertEqual(self.request(
            "/missions/%s/tasks/%s/run" % (mission["id"], task["id"]), "POST", {})[0], 200)
        with urllib.request.urlopen(
                self.base + "/missions/" + mission["id"] + "/deliverables.zip") as response:
            body = response.read()
            self.assertEqual(response.status, 200)
            self.assertIn("application/zip", response.headers.get("Content-Type", ""))
        archive = zipfile.ZipFile(io.BytesIO(body))
        names = archive.namelist()
        self.assertIn("MANIFEST.md", names)
        self.assertTrue(any(name.endswith(".md") for name in names))
        self.request("/missions/%s" % mission["id"], "DELETE")

    def test_mission_autorun_completes_every_task(self):
        status, data = self.request("/missions", "POST", {
            "title": "Full auto mission",
            "description": "Build and verify a landing page with independent QA and launch checks.",
            "acceptance": "Every task is complete and has a report.",
            "autoDiscuss": False,
            "autoRun": True,
        })
        self.assertEqual(status, 201, data)
        mission = data["mission"]
        mission_id = mission["id"]
        deadline = time.time() + 60
        latest = mission
        while time.time() < deadline:
            status, detail = self.request("/missions/%s" % mission_id)
            self.assertEqual(status, 200, detail)
            latest = detail["mission"]
            if (latest.get("autoRun") or {}).get("status") in ("done", "error", "waiting_boss"):
                break
            time.sleep(0.2)
        auto = latest.get("autoRun") or {}
        self.assertEqual(auto.get("status"), "done", latest)
        self.assertTrue(latest["tasks"])
        self.assertTrue(all(t["status"] == "done" for t in latest["tasks"]), latest)
        self.assertEqual(latest["stats"]["done"], len(latest["tasks"]))
        self.assertTrue(any(t.get("report") for t in latest["tasks"]))
        self.request("/missions/%s" % mission_id, "DELETE")

    def test_mission_autorun_honours_token_budget(self):
        status, data = self.request("/missions", "POST", {
            "title": "Budgeted auto mission",
            "description": "Build and verify a landing page with independent QA.",
            "acceptance": "Execution stops before an unbounded token spend.",
            "autoDiscuss": False,
            "autoRun": True,
            "tokenBudget": 5,
        })
        self.assertEqual(status, 201, data)
        mission_id = data["mission"]["id"]
        deadline = time.time() + 45
        latest = data["mission"]
        while time.time() < deadline:
            _, detail = self.request("/missions/%s" % mission_id)
            latest = detail["mission"]
            if (latest.get("autoRun") or {}).get("status") in ("done", "stopped", "error"):
                break
            time.sleep(0.2)
        auto = latest.get("autoRun") or {}
        self.assertEqual(auto.get("status"), "stopped", latest)
        self.assertIn("token budget", auto.get("error", ""))
        self.assertGreater(auto.get("tokensUsed", 0), 0)
        self.assertTrue(any(t["status"] == "done" for t in latest["tasks"]), latest)
        self.assertEqual(latest["tokenBudget"], 5)
        status, updated = self.request("/missions/%s/budget" % mission_id, "POST", {
            "tokenBudget": 100000,
        })
        self.assertEqual(status, 200, updated)
        self.assertEqual(updated["mission"]["tokenBudget"], 100000)
        self.request("/missions/%s" % mission_id, "DELETE")

    def test_mission_autorun_retries_a_transient_failure(self):
        MockProviderHandler.flaky_until = None
        status, data = self.request("/missions", "POST", {
            "title": "Retry auto mission",
            "description": "FLAKY_ONCE: build and verify a landing page with QA.",
            "acceptance": "A transient provider failure is retried and the mission completes.",
            "autoDiscuss": False,
            "autoRun": True,
        })
        self.assertEqual(status, 201, data)
        mission_id = data["mission"]["id"]
        deadline = time.time() + 70
        latest = data["mission"]
        while time.time() < deadline:
            _, detail = self.request("/missions/%s" % mission_id)
            latest = detail["mission"]
            if (latest.get("autoRun") or {}).get("status") in ("done", "error", "stopped", "waiting_boss"):
                break
            time.sleep(0.25)
        auto = latest.get("autoRun") or {}
        self.assertEqual(auto.get("status"), "done", latest)
        self.assertTrue(all(t["status"] == "done" for t in latest["tasks"]), latest)
        _, messages = self.request("/conversations/%s/messages" % latest["conversationId"])
        self.assertTrue(any("自动重试一次" in (m.get("text") or "") for m in messages["messages"]),
                        messages["messages"])
        self.request("/missions/%s" % mission_id, "DELETE")

    def test_mission_autorun_repairs_partial_ai_report(self):
        status, data = self.request("/missions", "POST", {
            "title": "Partial report auto mission",
            "description": "INCOMPLETE_REPORT: produce a weekly report and deliver it.",
            "acceptance": "A partial model report is repaired and all tasks complete.",
            "autoDiscuss": False,
            "autoRun": True,
        })
        self.assertEqual(status, 201, data)
        mission_id = data["mission"]["id"]
        deadline = time.time() + 60
        latest = data["mission"]
        while time.time() < deadline:
            _, detail = self.request("/missions/%s" % mission_id)
            latest = detail["mission"]
            if (latest.get("autoRun") or {}).get("status") in ("done", "error", "stopped", "waiting_boss"):
                break
            time.sleep(0.2)
        self.assertEqual((latest.get("autoRun") or {}).get("status"), "done", latest)
        self.assertTrue(all(t["status"] == "done" for t in latest["tasks"]), latest)
        reports = [t.get("report") or {} for t in latest["tasks"]]
        self.assertTrue(any(any("自动补齐" in risk for risk in (r.get("risks") or []))
                            for r in reports))
        self.request("/missions/%s" % mission_id, "DELETE")

    def test_mission_autorun_drops_invalid_boss_gate(self):
        status, data = self.request("/missions", "POST", {
            "title": "Invalid gate auto mission",
            "description": "INVALID_GATE: produce a weekly report and deliver it.",
            "acceptance": "Technical work is solved by the team and all tasks complete.",
            "autoDiscuss": False,
            "autoRun": True,
        })
        self.assertEqual(status, 201, data)
        mission_id = data["mission"]["id"]
        deadline = time.time() + 60
        latest = data["mission"]
        while time.time() < deadline:
            _, detail = self.request("/missions/%s" % mission_id)
            latest = detail["mission"]
            if (latest.get("autoRun") or {}).get("status") in ("done", "error"):
                break
            time.sleep(0.2)
        self.assertEqual((latest.get("autoRun") or {}).get("status"), "done", latest)
        self.assertTrue(all(t["status"] == "done" for t in latest["tasks"]), latest)
        reports = [t.get("report") or {} for t in latest["tasks"]]
        self.assertTrue(any(any("无效审批类型" in risk for risk in (r.get("risks") or []))
                            for r in reports))
        self.request("/missions/%s" % mission_id, "DELETE")

    def test_mission_autorun_can_discuss_then_run(self):
        status, data = self.request("/missions", "POST", {
            "title": "Discuss then run",
            "description": "Prepare a short weekly report and deliver it.",
            "acceptance": "The plan is discussed and every task completes.",
            "autoDiscuss": False,
            "autoRun": False,
        })
        self.assertEqual(status, 201, data)
        mission_id = data["mission"]["id"]
        status, started = self.request(
            "/missions/%s/autorun" % mission_id, "POST", {"discuss": True})
        self.assertEqual(status, 202, started)
        deadline = time.time() + 60
        latest = data["mission"]
        while time.time() < deadline:
            _, detail = self.request("/missions/%s" % mission_id)
            latest = detail["mission"]
            if (latest.get("autoRun") or {}).get("status") in ("done", "error"):
                break
            time.sleep(0.2)
        self.assertEqual((latest.get("autoRun") or {}).get("status"), "done", latest)
        self.assertIn((latest.get("discussion") or {}).get("status"), ("done", "partial"))
        self.assertTrue(all(t["status"] == "done" for t in latest["tasks"]), latest)
        self.request("/missions/%s" % mission_id, "DELETE")

    def test_mission_autorun_stop_endpoint(self):
        status, data = self.request("/missions", "POST", {
            "title": "Stop auto mission",
            "description": "Create a simple checklist and do not start automatically.",
            "acceptance": "The stop endpoint marks the run stopped.",
            "autoDiscuss": False,
            "autoRun": False,
        })
        self.assertEqual(status, 201, data)
        mission_id = data["mission"]["id"]
        status, stopped = self.request(
            "/missions/%s/autorun/stop" % mission_id, "POST", {})
        self.assertEqual(status, 202, stopped)
        self.assertEqual(stopped["autoRun"]["status"], "stopped")
        self.request("/missions/%s" % mission_id, "DELETE")

    def test_mission_autorun_pauses_for_approval_and_resumes(self):
        status, data = self.request("/missions", "POST", {
            "title": "Approval auto mission",
            "description": "NEEDS_APPROVAL: build a landing page and verify it end to end.",
            "acceptance": "All work completes after the boss approves the spend.",
            "autoDiscuss": False,
            "autoRun": True,
        })
        self.assertEqual(status, 201, data)
        mission_id = data["mission"]["id"]
        deadline = time.time() + 45
        latest = data["mission"]
        while time.time() < deadline:
            _, detail = self.request("/missions/%s" % mission_id)
            latest = detail["mission"]
            auto = latest.get("autoRun") or {}
            if auto.get("status") == "waiting_boss":
                break
            time.sleep(0.2)
        auto = latest.get("autoRun") or {}
        self.assertEqual(auto.get("status"), "waiting_boss", latest)
        pending = [a for a in latest.get("approvals", []) if a.get("status") == "pending"]
        self.assertTrue(pending, latest)
        self.assertEqual(pending[0]["type"], "spend")
        status, resolved = self.request(
            "/approvals/%s/resolve" % pending[0]["id"], "POST",
            {"decision": "approved", "note": "test approval"})
        self.assertEqual(status, 200, resolved)
        deadline = time.time() + 60
        while time.time() < deadline:
            _, detail = self.request("/missions/%s" % mission_id)
            latest = detail["mission"]
            auto = latest.get("autoRun") or {}
            if auto.get("status") in ("done", "error"):
                break
            time.sleep(0.2)
        self.assertEqual((latest.get("autoRun") or {}).get("status"), "done", latest)
        self.assertTrue(all(t["status"] == "done" for t in latest["tasks"]), latest)
        self.request("/missions/%s" % mission_id, "DELETE")

    def test_update_check_status_and_bad_token(self):
        status, data = self.request("/update/check?refresh=1")
        self.assertEqual(status, 200)
        self.assertTrue(data["updateAvailable"])
        self.assertEqual(data["latestVersion"], "9.9.9")
        self.assertTrue(data["token"])
        self.assertTrue(data["rollbackToken"])
        self.assertEqual(data["deployment"]["mode"], "archive")
        self.assertTrue(data["deployment"]["canApply"])

        status, job = self.request("/update/status")
        self.assertEqual(status, 200)
        self.assertEqual(job["status"], "idle")
        self.assertTrue(job["currentVersion"])
        self.assertTrue(job["bootId"])

        status, error = self.request("/update/apply", "POST", {
            "token": "not-a-real-token", "version": "9.9.9",
        })
        self.assertEqual(status, 403)
        self.assertEqual(error["code"], "bad_token")
        status, job = self.request("/update/status")
        self.assertEqual(job["status"], "idle")

        status, manual = self.request("/update/manual/token")
        self.assertEqual(status, 200)
        self.assertTrue(manual["token"])
        status, error = self.request("/update/manual", "POST", {"probe": True})
        self.assertEqual(status, 403)
        self.assertEqual(error["code"], "bad_token")

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
        self.request("/agents/%s" % claimed["agent"]["id"], "DELETE")

    def test_claim_cannot_take_over_supplied_id(self):
        pair = self.make_pair()
        status, data = self.request(
            "/pair/%s/claim" % pair["code"],
            "POST",
            {"id": "ext-demo-claude", "name": "Impostor", "runtime": "test"},
        )
        self.assertEqual(status, 200)
        self.assertNotEqual(data["agent"]["id"], "ext-demo-claude")
        self.request("/agents/%s" % data["agent"]["id"], "DELETE")

    def test_cancel_pending_pair(self):
        pair = self.make_pair()
        status, _ = self.request("/pair/%s" % pair["code"], "DELETE")
        self.assertEqual(status, 200)
        status, _ = self.request("/pair/%s" % pair["code"])
        self.assertEqual(status, 404)

    def test_cannot_cancel_claimed_pair(self):
        pair = self.make_pair()
        status, claimed = self.request("/pair/%s/claim" % pair["code"], "POST", {"name": "Owned"})
        self.assertEqual(status, 200)
        status, _ = self.request("/pair/%s" % pair["code"], "DELETE")
        self.assertEqual(status, 409)
        self.request("/agents/%s" % claimed["agent"]["id"], "DELETE")

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

    def test_provider_configure_tests_and_saves_without_leaking_key(self):
        original = self.providers_original
        try:
            status, data = self.request("/providers/doubao/configure", "POST", {
                "apiKey": "test-doubao-key",
                "baseUrl": "http://127.0.0.1:%d/v1" % self.mock_port,
                "model": "mock-doubao",
            })
            self.assertEqual(status, 200, data)
            self.assertTrue(data["saved"])
            self.assertEqual(data["test"]["model"], "mock-doubao")
            self.assertNotIn("test-doubao-key", json.dumps(data))
            self.assertNotIn("apiKey", json.dumps(data))
            saved = json.loads(self.providers_path.read_text("utf-8"))
            self.assertEqual(saved["doubao"]["apiKey"], "test-doubao-key")
            self.assertEqual(saved["doubao"]["model"], "mock-doubao")
            self.assertEqual(self.providers_path.stat().st_mode & 0o777, 0o600)
            status, catalog = self.request("/providers")
            doubao = next(p for p in catalog["providers"] if p["id"] == "doubao")
            self.assertTrue(doubao["configured"])
            self.assertEqual(doubao["keySource"], "file")
        finally:
            self.providers_path.write_text(original, "utf-8")

    def test_provider_environment_detection_and_save(self):
        original = self.providers_original
        try:
            status, catalog = self.request("/providers")
            self.assertEqual(status, 200)
            kimi = next(p for p in catalog["providers"] if p["id"] == "kimi")
            self.assertTrue(kimi["configured"])
            self.assertEqual(kimi["keySource"], "environment")
            self.assertEqual(kimi["baseSource"], "environment")
            self.assertTrue(kimi["detected"])
            self.assertNotIn("test-env-kimi", json.dumps(catalog))

            status, data = self.request("/providers/kimi/configure", "POST", {
                "useEnvironment": True,
            })
            self.assertEqual(status, 200, data)
            self.assertTrue(data["saved"])
            saved = json.loads(self.providers_path.read_text("utf-8"))
            self.assertEqual(saved["kimi"]["apiKey"], "test-env-kimi")
            self.assertEqual(saved["kimi"]["model"], "mock-kimi-env")
            self.assertNotIn("test-env-kimi", json.dumps(data))
        finally:
            self.providers_path.write_text(original, "utf-8")

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
        self.request("/agents/ext-deepseek", "DELETE")

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
        self.request("/agents/ext-test-assign", "DELETE")
        self.request("/agents/ext-test-cancel", "DELETE")

    def test_company_template_chat_isolation_and_dispatch(self):
        status, data = self.request("/company/bootstrap", "POST", {
            "name": "Solo Studio", "product": "AI landing page",
            "goal": "Ship a validated landing page", "language": "zh",
            "template": "one-person-company"
        })
        self.assertEqual(status, 200, data)
        company = data["company"]
        self.assertEqual(company["id"][:4], "opc-")
        self.assertEqual(len(company["roles"]), 8)
        self.assertEqual(len(company["tasks"]), 11)
        self.assertTrue(any(t["status"] == "assigned" for t in company["tasks"]))
        self.assertTrue(any(t["status"] == "waiting" for t in company["tasks"]))

        product_role = next(r for r in company["roles"] if r["id"] == "product")
        t1 = next(t for t in company["tasks"] if t["id"] == "opc-t1")
        t2 = next(t for t in company["tasks"] if t["id"] == "opc-t2")
        assignment = next(a for a in company["assignments"] if a["companyTaskId"] == "opc-t1")
        t2_room = next(r for r in company["rooms"] if r.get("taskId") == "opc-t2")
        self.assertTrue(assignment["executionId"].startswith("exec-"))
        self.assertEqual(assignment["roomId"], t1["roomId"])

        status, msg = self.request("/messages", "POST", {
            "agentId": product_role["agentId"],
            "roomId": assignment["roomId"],
            "assignmentId": assignment["id"],
            "executionId": assignment["executionId"],
            "content": "Offer draft is ready."
        })
        self.assertEqual(status, 200, msg)

        status, _ = self.request("/messages", "POST", {
            "agentId": product_role["agentId"],
            "roomId": t2_room["id"],
            "assignmentId": assignment["id"],
            "executionId": assignment["executionId"],
            "content": "wrong room"
        })
        self.assertEqual(status, 400)

        status, _ = self.request("/messages", "POST", {
            "agentId": product_role["agentId"],
            "roomId": assignment["roomId"],
            "assignmentId": assignment["id"],
            "executionId": "exec-wrong",
            "content": "wrong execution"
        })
        self.assertEqual(status, 400)

        status, human = self.request("/messages", "POST", {
            "roomId": "opc-room-founder", "content": "Founder note"
        })
        self.assertEqual(status, 200, human)

        status, pair_data = self.request("/pair/code", "POST", {"roleId": "copy"})
        self.assertEqual(status, 200)
        self.assertEqual(pair_data["pair"]["roleId"], "copy")
        status, claimed = self.request("/pair/%s/claim" % pair_data["pair"]["code"], "POST", {
            "name": "Copy Worker", "runtime": "claude-code"
        })
        self.assertEqual(status, 200)
        self.assertEqual(claimed["agent"]["id"], "opc-copy")
        status, company_after = self.request("/company")
        copy_role = next(r for r in company_after["company"]["roles"] if r["id"] == "copy")
        self.assertEqual(copy_role["agentName"], "Copy Worker")

        status, done = self.request("/assignments/" + assignment["id"], "PATCH", {
            "status": "completed", "progress": 100,
            "result": "Offer validated", "evidence": ["docs/offer.md"]
        })
        self.assertEqual(status, 200)
        status, company_after = self.request("/company")
        t1_after = next(t for t in company_after["company"]["tasks"] if t["id"] == "opc-t1")
        t3_after = next(t for t in company_after["company"]["tasks"] if t["id"] == "opc-t3")
        self.assertEqual(t1_after["status"], "completed")
        self.assertEqual(t3_after["status"], "assigned")
        self.assertTrue(t3_after["assignmentId"])

        status, cleanup = self.request("/company", "DELETE")
        self.assertEqual(status, 200)

    def test_sse_stream_delivers_chat(self):
        status, data = self.request("/company/bootstrap", "POST", {
            "name": "SSE Test", "product": "stream", "goal": "verify SSE",
            "language": "en", "replace": True
        })
        self.assertEqual(status, 200)
        conn = HTTPConnection("127.0.0.1", self.port, timeout=8)
        try:
            conn.request("GET", "/stream?since=0")
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            # Consume the initial ready frame.
            deadline = time.time() + 3
            ready = False
            while time.time() < deadline:
                line = res.readline().decode("utf-8", "replace").strip()
                if line == "event: ready":
                    ready = True
                    break
                if not line:
                    continue
            self.assertTrue(ready)
            status, _ = self.request("/messages", "POST", {
                "roomId": "opc-room-founder", "content": "sse-stream-test"
            })
            self.assertEqual(status, 200)
            found = False
            deadline = time.time() + 6
            while time.time() < deadline:
                line = res.readline().decode("utf-8", "replace").strip()
                if line.startswith("data:") and "sse-stream-test" in line:
                    found = True
                    break
            self.assertTrue(found)
        finally:
            conn.close()
            self.request("/company", "DELETE")

    def test_missing_agent_event_is_rejected(self):
        status, data = self.request("/events", "POST", {"agentId": "ext-missing", "kind": "skill"})
        self.assertEqual(status, 400)
        self.assertIn("unknown agentId", data["error"])


if __name__ == "__main__":
    unittest.main()
