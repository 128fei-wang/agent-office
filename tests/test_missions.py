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

    def test_revision_tracks_task_and_approval_changes(self):
        mission = self.make()
        revision = self.store.revision()
        task = mission["tasks"][0]
        self.store.update_task(task["id"], {"status": "in_progress", "progress": 30})
        changed = self.store.revision()
        self.assertNotEqual(revision, changed)
        self.assertEqual(changed, self.store.revision())

    def test_scheduled_autorun_status(self):
        mission = self.make(autoRun=True, scheduleAt="2030-01-01T10:00")
        self.assertEqual(mission["autoRun"]["status"], "scheduled")
        self.assertEqual(mission["autoRun"]["scheduledAt"], "2030-01-01T10:00")

    def test_archive_and_public_flag(self):
        mission = self.make()
        archived = self.store.set_archived(mission["id"], True)
        self.assertTrue(archived["archived"])
        reopened = self.store.get_mission(mission["id"])
        self.assertTrue(reopened["archived"])
        restored = self.store.set_archived(mission["id"], False)
        self.assertFalse(restored["archived"])

    def test_task_editable_fields(self):
        mission = self.make()
        task = mission["tasks"][0]
        updated = self.store.update_task(task["id"], {
            "title": "Edited task title",
            "brief": "Edited brief",
            "acceptance": "Edited acceptance",
            "priority": "P0",
        })
        self.assertEqual(updated["title"], "Edited task title")
        self.assertEqual(updated["brief"], "Edited brief")
        self.assertEqual(updated["acceptance"], "Edited acceptance")
        self.assertEqual(updated["priority"], "P0")

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
        self.assertEqual(external["logoUrl"], "assets/logos/codex.svg")
        workbuddy = missions.normalize_agent({
            "id": "ext-wb", "name": "Demo Worker · WorkBuddy", "runtime": "workbuddy",
        }, "external")
        self.assertEqual(workbuddy["brand"], "WorkBuddy")
        self.assertEqual(workbuddy["logoText"], "WB")
        self.assertEqual(workbuddy["logoUrl"], "assets/logos/workbuddy.svg")
        doubao = missions.normalize_agent({
            "id": "ext-doubao", "name": "Doubao", "runtime": "doubao-agent",
        }, "external")
        self.assertEqual(doubao["brand"], "Doubao")
        self.assertEqual(doubao["logoText"], "豆")
        self.assertEqual(doubao["logoUrl"], "assets/logos/doubao-mark.svg")
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
        self.assertEqual(result["scope"], "external")
        self.assertEqual(result["candidateCount"], 2)
        self.assertTrue(result["suggestedMemberIds"])
        self.assertTrue(all(not item.startswith("msn-") for item in result["suggestedMemberIds"]))
        self.assertTrue(result["preferredExecutors"])
        self.assertTrue(all(a["source"] == "external"
                            for task in result["tasks"]
                            for a in task["recommended"]))
        self.assertTrue(any(a.get("logoText") for a in result["tasks"][0]["recommended"]))
        self.assertTrue(all("estimate" in task for task in result["tasks"]))
        avatar = missions.normalize_agent({
            "id": "ext-avatar", "name": "Avatar Test", "avatar": "fox",
            "avatarColor": "#ffb45e",
        }, "external")
        self.assertEqual(avatar["logoText"], "🦊")
        custom = missions.normalize_agent({
            "id": "ext-custom", "name": "Custom Test", "avatar": "custom",
            "avatarText": "Z9", "avatarColor": "#123456",
        }, "external")
        self.assertEqual(custom["logoText"], "Z9")
        self.assertEqual(custom["logoColor"], "#123456")

        fallback = self.store.recommend(missions.builtin_directory(), {
            "description": "Build and test a landing page with code and QA.",
            "acceptance": "Tests pass.",
        })
        self.assertEqual(fallback["scope"], "system")
        self.assertIn("msn-engineer", fallback["suggestedMemberIds"])

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

    def test_real_only_recommendation_never_falls_back_to_presets(self):
        result = self.store.recommend(missions.builtin_directory(), {
            "description": "Build and test a landing page with code and QA.",
            "acceptance": "Tests pass.",
            "realOnly": True,
        })
        self.assertEqual(result["scope"], "external")
        self.assertTrue(result["requiresExternal"])
        self.assertEqual(result["candidateCount"], 0)
        self.assertEqual(result["suggestedMemberIds"], [])
        self.assertTrue(result["tasks"])
        self.assertTrue(all(not task["recommended"] for task in result["tasks"]))

    def test_real_only_mission_rejects_system_roles(self):
        with self.assertRaises(missions.MissionError) as raised:
            self.store.create_mission({
                "title": "Real only mission",
                "description": "Build and test a landing page with code and QA.",
                "realOnly": True,
            }, missions.builtin_directory())
        self.assertEqual(raised.exception.code, "no_external_agents")

        mission = self.store.create_mission({
            "title": "Real only mission",
            "description": "Build and test a landing page with code and QA.",
            "realOnly": True,
            "memberIds": ["ext-test"],
            "autoDiscuss": False,
        }, self.directory)
        self.assertEqual(mission["memberScope"], "external")
        self.assertTrue(mission["members"])
        self.assertTrue(all(member["source"] == "external" for member in mission["members"]))

    def test_completed_mission_coverage_and_previous_link(self):
        mission = self.make(previousMissionId="msn-previous")
        self.assertEqual(mission["previousMissionId"], "msn-previous")
        for task in mission["tasks"]:
            self.store.update_task(task["id"], {"status": "done"})
        done = self.store.get_mission(mission["id"])
        self.assertTrue(done["coverage"]["completed"])
        self.assertTrue(done["coverage"]["noIdle"])
        self.assertEqual(done["coverage"]["assigned"], done["coverage"]["total"])
        self.assertEqual(done["coverage"]["idle"], [])

    def test_token_budget_is_stored_and_editable(self):
        mission = self.make(tokenBudget=120000)
        self.assertEqual(mission["tokenBudget"], 120000)
        self.assertEqual(mission["autoRun"]["tokenBudget"], 120000)
        self.assertEqual(mission["autoRun"].get("currentTaskStartedAt"), "")
        updated = self.store.update_token_budget(mission["id"], 250000)
        self.assertEqual(updated["tokenBudget"], 250000)
        self.assertEqual(updated["autoRun"]["tokenBudget"], 250000)
        self.assertEqual(updated["evaluation"]["tokenBudget"], 250000)
        self.assertEqual(updated["evaluation"]["tokenBudgetRemaining"], 250000)
        self.assertEqual(updated["evaluation"]["totalTokens"], 0)
        with self.assertRaises(missions.MissionError) as raised:
            self.store.update_token_budget(mission["id"], "not-a-number")
        self.assertEqual(raised.exception.code, "bad_budget")
        with self.assertRaises(missions.MissionError) as raised:
            self.store.update_token_budget(mission["id"], "inf")
        self.assertEqual(raised.exception.code, "bad_budget")

    def test_group_and_direct_conversations(self):
        group = self.store.create_conversation({
            "kind": "group", "title": "Review", "memberIds": ["msn-product", "msn-qa"],
        }, self.directory)
        direct = self.store.create_conversation({
            "kind": "direct", "memberIds": ["msn-qa"],
        }, self.directory)
        self.assertEqual(group["kind"], "group")
        self.assertEqual(direct["kind"], "direct")
        self.assertFalse(group["pinned"])
        self.assertFalse(group["muted"])
        self.assertEqual(group["unreadCount"], 0)
        message = self.store.post_message(group["id"], {
            "senderId": "boss", "senderType": "boss", "type": "text", "text": "hello",
        })
        self.assertEqual(message["text"], "hello")
        self.assertEqual(self.store.get_conversation(group["id"])["unreadCount"], 0)
        agent = next(m for m in group["members"])
        self.store.post_message(group["id"], {
            "senderId": agent["id"], "senderType": "agent", "type": "text", "text": "reply",
        })
        unread = self.store.get_conversation(group["id"])
        self.assertEqual(unread["unreadCount"], 1)
        self.assertEqual(unread["lastMessage"]["senderType"], "agent")
        self.assertEqual(unread["lastSeq"], unread["lastMessage"]["seq"])
        updated = self.store.update_conversation(group["id"], {
            "title": "Review v2", "pinned": True, "muted": True,
            "readSeq": unread["lastSeq"],
        })
        self.assertEqual(updated["title"], "Review v2")
        self.assertTrue(updated["pinned"])
        self.assertTrue(updated["muted"])
        self.assertEqual(updated["readSeq"], unread["lastSeq"])
        self.assertEqual(updated["unreadCount"], 0)
        with self.assertRaises(missions.MissionError):
            self.store.update_conversation(group["id"], {"readSeq": "bad"})
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

    def test_memory_crud_context_and_search(self):
        workspace = self.store.create_memory({
            "title": "Launch rollback",
            "text": "Always rehearse a rollback before a public launch.",
            "scope": "workspace",
            "tags": ["launch", "risk"],
            "pinned": True,
        })
        agent = self.store.create_memory({
            "title": "Kai test preference",
            "text": "Prefer integration tests before visual polish.",
            "scope": "agent",
            "agentId": "ext-test",
        })
        self.assertEqual(len(self.store.list_memories()), 2)
        self.assertEqual(len(self.store.list_memories(scope="workspace")), 1)
        self.assertEqual(len(self.store.list_memories(agent_id="ext-test")), 2)
        self.assertIn("rollback", self.store.memory_context(["ext-test"]).lower())
        self.assertIn("integration tests", self.store.memory_context(["ext-test"]).lower())
        updated = self.store.update_memory(workspace["id"], {
            "title": "Launch rollback drill", "pinned": False
        })
        self.assertEqual(updated["title"], "Launch rollback drill")
        found = self.store.search("rollback")
        self.assertTrue(any(m["id"] == workspace["id"] for m in found["memories"]))
        self.assertTrue(self.store.delete_memory(agent["id"]))
        self.assertEqual(len(self.store.list_memories()), 1)


if __name__ == "__main__":
    unittest.main()
