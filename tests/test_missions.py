#!/usr/bin/env python3
"""Unit tests for the mission workspace. Standard library only."""
import json
import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import missions  # noqa: E402


def agents():
    rows = missions.builtin_directory()
    rows.append({
        "id": "ext-test", "name": "Test Worker", "role": "engineer",
        "titleZh": "测试执行器", "titleEn": "Test Worker",
        "skills": ["edit", "test", "review"], "color": "#7cb7ff",
        "source": "external", "virtual": False,
    })
    return rows


class MissionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ao-mission-test-"))
        self.store = missions.MissionStore(self.tmp / "missions.json", self.tmp / "uploads")
        self.directory = agents()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def make(self, **kwargs):
        body = {
            "title": "Test mission",
            "description": "Build and launch a landing page with copy, design, code, QA and analytics.",
            "acceptance": "Page works on mobile and conversion events are verified.",
            "autoDiscuss": False,
        }
        body.update(kwargs)
        return self.store.create_mission(body, self.directory)

    def test_plan_assigns_every_member_and_creates_group(self):
        mission = self.make()
        self.assertTrue(mission["conversationId"])
        self.assertGreaterEqual(len(mission["tasks"]), 6)
        self.assertTrue(mission["coverage"]["noIdle"])
        self.assertEqual(mission["coverage"]["idle"], [])
        for member in mission["members"]:
            self.assertTrue(any(t["assigneeId"] == member["id"] for t in mission["tasks"]))
            self.assertTrue(all(t.get("assignmentReason") for t in mission["tasks"]
                                if t["assigneeId"] == member["id"]))
        conversation = self.store.get_conversation(mission["conversationId"])
        self.assertEqual(conversation["kind"], "group")
        messages = self.store.list_messages(mission["conversationId"])
        self.assertEqual(messages[0]["type"], "mission-created")
        self.assertIn("老板门禁", messages[0]["text"])

    def test_recommendation_estimates_and_logos(self):
        external = missions.normalize_agent({
            "id": "ext-codex", "name": "Codex Worker", "runtime": "codex",
            "skills": ["repo-map", "edit", "test"], "color": "#7cb7ff",
            "online": True,
        }, "external")
        self.assertEqual(external["brand"], "Codex")
        self.assertEqual(external["logoText"], "CX")
        workbuddy = missions.normalize_agent({
            "id": "ext-wb", "name": "小研 · WorkBuddy", "runtime": "workbuddy",
        }, "external")
        self.assertEqual(workbuddy["brand"], "WorkBuddy")
        self.assertEqual(workbuddy["logoText"], "WB")
        unknown = missions.normalize_agent({
            "id": "ext-zed", "name": "Zed Worker", "runtime": "http",
        }, "external")
        self.assertEqual(unknown["brand"], "External agent")
        self.assertEqual(unknown["logoText"], "ZW")
        directory = self.directory + [external]
        result = self.store.recommend(directory, {
            "description": "Build and test a landing page with code and QA.",
            "acceptance": "Tests pass.",
        })
        self.assertGreaterEqual(len(result["tasks"]), 4)
        self.assertTrue(result["suggestedMemberIds"])
        self.assertTrue(result["preferredExecutors"])
        self.assertTrue(any(a.get("logoText") for a in result["tasks"][0]["recommended"]))
        self.assertTrue(all("estimate" in task for task in result["tasks"]))

    def test_estimates_actuals_and_preferred_executor(self):
        mission = self.make(preferredExecutors={"requirements": "ext-test"})
        requirements = next(t for t in mission["tasks"] if t["key"] == "requirements")
        self.assertEqual(requirements["assigneeId"], "ext-test")
        self.assertTrue(requirements["estimate"]["minutes"] > 0)
        self.assertTrue(requirements["estimate"]["tokens"] > 0)
        self.store.submit_task_report(requirements["id"], {
            "usage": {"provider": "test", "model": "mock",
                      "tokensIn": 100, "tokensOut": 50, "durationMs": 1200},
            "report": {"summary": "done", "done": ["x"], "next": ["y"],
                       "risks": ["z"], "solution": "fallback", "evidence": ["e"]},
        })
        _, task = self.store.find_task(requirements["id"])
        self.assertEqual(task["actual"]["tokens"], 150)
        self.assertEqual(task["actual"]["durationMs"], 1200)
        public = self.store.get_mission(mission["id"])
        self.assertGreaterEqual(public["evaluation"]["actualTokens"], 150)
        self.assertEqual(public["evaluation"]["actualDurationMs"], 1200)
        self.assertTrue(public["evaluation"]["agents"])

    def test_budget_creates_spend_approval(self):
        mission = self.make(budget=250)
        approvals = [a for a in self.store.list_approvals("pending")
                     if a["missionId"] == mission["id"]]
        self.assertEqual(len(approvals), 1)
        self.assertEqual(approvals[0]["type"], "spend")
        self.assertEqual(approvals[0]["amount"], 250.0)

    def test_report_validation_and_approval(self):
        mission = self.make()
        member = mission["members"][0]
        with self.assertRaises(missions.MissionError) as raised:
            self.store.post_message(mission["conversationId"], {
                "senderId": member["id"], "senderType": "agent", "type": "report",
                "report": {"summary": "x", "done": ["a"], "next": ["b"],
                           "risks": ["c"], "solution": ""},
            })
        self.assertEqual(raised.exception.code, "report_needs_solution")

        with self.assertRaises(missions.MissionError) as raised:
            self.store.post_message(mission["conversationId"], {
                "senderId": member["id"], "senderType": "agent", "type": "report",
                "report": {"summary": "x", "done": ["a"], "next": ["b"],
                           "risks": ["c"], "solution": "fallback",
                           "needsBoss": ["technical"]},
            })
        self.assertEqual(raised.exception.code, "technical_issue_must_be_solved")

        message = self.store.post_message(mission["conversationId"], {
            "senderId": member["id"], "senderType": "agent", "type": "report",
            "report": {
                "summary": "Need a domain", "done": ["research"], "next": ["buy"],
                "risks": ["budget"], "solution": "Buy the smallest domain first",
                "evidence": ["doc"], "needsBoss": ["spend"],
                "approval": {"type": "spend", "title": "Domain",
                             "amount": 20, "currency": "CNY"},
            },
        })
        self.assertEqual(message["type"], "report")
        approvals = [a for a in self.store.list_approvals("pending")
                     if a["missionId"] == mission["id"]]
        self.assertEqual(len(approvals), 1)
        resolved = self.store.resolve_approval(approvals[0]["id"], "approved", "ok")
        self.assertEqual(resolved["status"], "approved")

    def test_decision_options_are_normalized(self):
        mission = self.make()
        approval = self.store.create_approval(mission, {
            "type": "decision", "title": "Pick a route",
            "options": ["Route A", "Route B"], "requestedBy": mission["members"][0]["id"],
        })
        self.assertEqual(len(approval["options"]), 2)
        resolved = self.store.resolve_approval(
            approval["id"], "approved", "A", approval["options"][0]["id"])
        self.assertEqual(resolved["status"], "approved")

    def test_group_and_direct_conversations(self):
        group = self.store.create_conversation({
            "kind": "group", "title": "Review", "memberIds": ["msn-product", "msn-qa"],
        }, self.directory)
        direct = self.store.create_conversation({
            "kind": "direct", "memberIds": ["msn-qa"],
        }, self.directory)
        self.assertEqual(group["kind"], "group")
        self.assertEqual(direct["kind"], "direct")
        message = self.store.post_message(group["id"], {
            "senderId": "boss", "senderType": "boss", "type": "text", "text": "hello",
        })
        self.assertEqual(message["text"], "hello")
        with self.assertRaises(missions.MissionError):
            self.store.post_message(group["id"], {
                "senderId": "ext-not-a-member", "senderType": "agent", "text": "nope",
            })
        self.assertTrue(self.store.delete_conversation(group["id"]))
        self.assertTrue(self.store.delete_conversation(direct["id"]))

    def test_extract_text_markdown_and_docx(self):
        md = self.tmp / "brief.md"
        md.write_text("# Brief\nShip it.", "utf-8")
        text, kind = missions.extract_text(md, "text/markdown", "brief.md")
        self.assertIn("Ship it", text)
        self.assertEqual(kind, "text")

        docx = self.tmp / "brief.docx"
        with zipfile.ZipFile(docx, "w") as zf:
            zf.writestr("word/document.xml",
                        "<w:document><w:p><w:t>Hello docx</w:t></w:p></w:document>")
        text, kind = missions.extract_text(docx, "", "brief.docx")
        self.assertIn("Hello docx", text)
        self.assertEqual(kind, "docx")

    def test_completing_dependencies_promotes_tasks(self):
        mission = self.make()
        requirements = next(t for t in mission["tasks"] if t["key"] == "requirements")
        design = next(t for t in mission["tasks"] if t["key"] == "design")
        self.assertEqual(requirements["status"], "assigned")
        self.assertEqual(design["status"], "queued")
        self.store.update_task(requirements["id"], {"status": "done"})
        _, design_after = self.store.find_task(design["id"])
        self.assertEqual(design_after["status"], "assigned")


if __name__ == "__main__":
    unittest.main()
