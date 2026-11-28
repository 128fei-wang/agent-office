#!/usr/bin/env python3
"""Tamper-evident evidence receipts and chain verification."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import evidence  # noqa: E402
import missions  # noqa: E402


def sample_report(summary="已完成"):
    return {
        "summary": summary,
        "done": ["实现"],
        "next": ["继续"],
        "risks": ["无"],
        "solution": "已给出解决方案",
        "evidence": ["test/test_ok.py"],
    }


class EvidenceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ao-evidence-")
        self.root = Path(self.tmp.name)
        self.log = evidence.EvidenceLog(
            self.root / "evidence.json", self.root / "evidence.key")
        self.artifact_path = self.root / "test_ok.py"
        self.artifact_path.write_text(
            "import unittest\nclass T(unittest.TestCase):\n"
            "    def test_ok(self): self.assertTrue(True)\n",
            encoding="utf-8")
        self.artifact = {
            "id": "art-1", "name": "test/test_ok.py",
            "size": self.artifact_path.stat().st_size,
            "path": str(self.artifact_path),
        }
        self.task = {
            "id": "task-1", "title": "证据测试",
            "report": sample_report(), "artifactIds": ["art-1"],
        }
        self.tasks = {"task-1": self.task}
        self.artifacts = {"art-1": self.artifact}

    def tearDown(self):
        self.tmp.cleanup()

    def issue(self, **overrides):
        values = {
            "mission_id": "msn-1", "task_id": "task-1",
            "task_title": "证据测试", "report": self.task["report"],
            "artifacts": [self.artifact], "agent_id": "msn-product",
            "agent_name": "产品经理", "source": "bridge-ai",
            "status": "review", "identity_basis": "local-member",
            "identity_verified": True,
        }
        values.update(overrides)
        return self.log.issue(**values)

    def verify(self):
        return self.log.verify("msn-1", tasks=self.tasks,
                               artifacts_by_id=self.artifacts)

    def test_key_and_log_permissions_are_private(self):
        self.assertEqual(self.root.joinpath("evidence.key").stat().st_mode & 0o077, 0)
        self.issue()
        self.assertEqual(self.root.joinpath("evidence.json").stat().st_mode & 0o077, 0)
        self.assertEqual(self.root.joinpath("evidence.anchor").stat().st_mode & 0o077, 0)

    def test_receipt_is_signed_and_verifies(self):
        receipt = self.issue()
        self.assertEqual(receipt["seq"], 1)
        self.assertEqual(receipt["prevHash"], evidence.GENESIS)
        self.assertEqual(len(receipt["signature"]), 64)
        result = self.verify()
        self.assertTrue(result["valid"], result)
        self.assertEqual(result["status"], "valid")
        self.assertEqual(result["receipts"][0]["checks"]["report"], "passed")
        self.assertEqual(result["receipts"][0]["checks"]["artifacts"], "passed")
        self.assertEqual(result["receipts"][0]["attestation"]["signer"],
                         "bridge-local-hmac")

    def test_report_change_is_detected(self):
        self.issue()
        self.task["report"] = sample_report("被修改的汇报")
        result = self.verify()
        self.assertEqual(result["status"], "changed")
        self.assertEqual(result["receipts"][0]["checks"]["report"], "changed")
        self.assertEqual(result["receipts"][0]["checks"]["signature"], "passed")

    def test_artifact_change_is_detected(self):
        self.issue()
        self.artifact_path.write_text("changed", encoding="utf-8")
        result = self.verify()
        self.assertEqual(result["status"], "changed")
        self.assertEqual(result["receipts"][0]["checks"]["artifacts"], "changed")

    def test_missing_artifact_is_detected(self):
        self.issue()
        self.artifact_path.unlink()
        self.artifacts.pop("art-1")
        result = self.verify()
        self.assertEqual(result["status"], "changed")
        self.assertEqual(result["receipts"][0]["checks"]["artifacts"], "missing")

    def test_receipt_tamper_is_detected(self):
        self.issue()
        raw = json.loads((self.root / "evidence.json").read_text("utf-8"))
        raw["receipts"][0]["reportSummary"] = "tampered"
        (self.root / "evidence.json").write_text(json.dumps(raw), "utf-8")
        result = self.verify()
        self.assertEqual(result["status"], "tampered")
        self.assertEqual(result["receipts"][0]["checks"]["payload"], "failed")
        self.assertEqual(result["receipts"][0]["checks"]["signature"], "failed")

    def test_key_change_is_detected(self):
        self.issue()
        other_key = self.root / "other.key"
        other = evidence.EvidenceLog(self.root / "evidence.json", other_key)
        result = other.verify("msn-1", tasks=self.tasks,
                              artifacts_by_id=self.artifacts)
        self.assertEqual(result["status"], "tampered")
        self.assertEqual(result["receipts"][0]["checks"]["signature"], "failed")

    def test_chain_and_head_are_verified(self):
        self.issue()
        second = self.issue(agent_id="msn-qa", task_id="task-2")
        self.assertEqual(second["seq"], 2)
        first = self.log.list("msn-1")[0]
        self.assertEqual(second["prevHash"], first["payloadHash"])
        self.tasks["task-2"] = dict(self.task, id="task-2")
        result = self.verify()
        self.assertTrue(result["valid"], result)
        raw = json.loads((self.root / "evidence.json").read_text("utf-8"))
        raw["receipts"][0]["prevHash"] = evidence.GENESIS + "0"
        (self.root / "evidence.json").write_text(json.dumps(raw), "utf-8")
        result = self.verify()
        self.assertEqual(result["status"], "tampered")
        self.assertEqual(result["receipts"][0]["checks"]["chain"], "failed")

    def test_truncation_is_detected(self):
        self.issue()
        self.issue(agent_id="msn-qa", task_id="task-2")
        raw = json.loads((self.root / "evidence.json").read_text("utf-8"))
        raw["receipts"] = raw["receipts"][:1]
        (self.root / "evidence.json").write_text(json.dumps(raw), "utf-8")
        result = self.verify()
        self.assertEqual(result["status"], "tampered")
        self.assertTrue(any("head" in item for item in result["issues"]))

    def test_whole_file_rollback_is_detected_by_anchor(self):
        self.issue()
        snapshot = (self.root / "evidence.json").read_text("utf-8")
        self.issue(agent_id="msn-qa", task_id="task-2")
        (self.root / "evidence.json").write_text(snapshot, "utf-8")
        result = self.verify()
        self.assertEqual(result["status"], "tampered")
        self.assertEqual(result["anchor"], "failed")
        self.assertTrue(any("rollback" in item for item in result["issues"]))

    def test_bundle_does_not_export_the_key(self):
        self.issue()
        bundle = self.log.bundle("msn-1", self.verify())
        dumped = json.dumps(bundle)
        key_hex = (self.root / "evidence.key").read_text("utf-8").strip()
        self.assertNotIn(key_hex, dumped)
        self.assertEqual(bundle["schema"], evidence.BUNDLE_SCHEMA)
        self.assertEqual(len(bundle["receipts"]), 1)

    def test_external_identity_is_labeled_not_verified(self):
        receipt = self.issue(source="external-agent", identity_basis="mcp-header",
                             identity_verified=False)
        self.assertEqual(receipt["attestation"]["identityBasis"], "mcp-header")
        self.assertFalse(receipt["attestation"]["identityVerified"])
        self.assertEqual(receipt["source"], "external-agent")

    def test_empty_log_verifies_as_empty(self):
        result = self.verify()
        self.assertEqual(result["status"], "empty")
        self.assertFalse(result["valid"])
        self.assertEqual(result["receiptCount"], 0)

    def test_corrupt_log_fails_closed(self):
        (self.root / "evidence.json").write_text("{not json", "utf-8")
        with self.assertRaises(evidence.EvidenceError):
            evidence.EvidenceLog(self.root / "evidence.json",
                                 self.root / "evidence.key")


class MissionEvidenceIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ao-evidence-store-")
        self.root = Path(self.tmp.name)
        self.log = evidence.EvidenceLog(
            self.root / "evidence.json", self.root / "evidence.key")
        self.store = missions.MissionStore(
            self.root / "missions.json", self.root / "uploads", evidence=self.log)
        directory = missions.builtin_directory()
        self.mission = self.store.create_mission({
            "title": "证据集成任务", "description": "验证任务汇报生成证据回执。",
            "acceptance": "回执可验证。", "memberIds": [directory[0]["id"]],
            "autoRun": False,
        }, directory)
        self.task = self.mission["tasks"][0]
        self.artifact_path = self.store.upload_dir / "deliverable.py"
        self.artifact_path.parent.mkdir(parents=True, exist_ok=True)
        self.artifact_path.write_text(
            "print('ok')\n", encoding="utf-8")
        self.artifact = self.store.add_artifact({
            "name": "deliverable.py", "path": str(self.artifact_path),
            "size": self.artifact_path.stat().st_size,
            "missionId": self.mission["id"],
            "uploadedBy": self.task["assigneeId"],
            "extractedText": "print('ok')\n",
        })
        with self.store.lock:
            _, raw_task = self.store.find_task(self.task["id"])
            raw_task["artifactIds"] = [self.artifact["id"]]
            self.store._save()

    def tearDown(self):
        self.tmp.cleanup()

    def test_unknown_artifact_is_rejected_before_report(self):
        with self.assertRaises(missions.MissionError):
            with self.store.lock:
                self.store.submit_task_report(
                    self.task["id"],
                    {"report": sample_report(), "artifactIds": ["art-does-not-exist"]},
                    actor=self.task["assigneeId"], status="review")

    def test_report_creates_receipt_and_public_task_exposes_it(self):
        report = sample_report()
        with self.store.lock:
            out = self.store.submit_task_report(
                self.task["id"], {"report": report},
                actor=self.task["assigneeId"], status="review")
        self.assertEqual(len(out.get("evidenceIds") or []), 1)
        self.assertEqual(len(out.get("evidence") or []), 1)
        receipt = out["evidence"][0]
        self.assertEqual(receipt["taskId"], self.task["id"])
        self.assertEqual(receipt["source"], "bridge-ai")
        raw_mission = self.store.find_mission(self.mission["id"])
        tasks = {row["id"]: row for row in raw_mission["tasks"]}
        artifacts = {row["id"]: row for row in self.store.data["artifacts"]
                     if row.get("missionId") == self.mission["id"]}
        result = self.log.verify(self.mission["id"], tasks=tasks,
                                 artifacts_by_id=artifacts)
        self.assertTrue(result["valid"], result)
        self.assertEqual(result["receipts"][0]["checks"]["artifacts"], "passed")
        self.assertEqual(len(result["receipts"][0]["artifacts"]), 1)


if __name__ == "__main__":
    unittest.main()
