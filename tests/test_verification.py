#!/usr/bin/env python3
"""Tests for real deliverable evidence checks."""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import verification  # noqa: E402


class VerificationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ao-verify-test-"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def artifact(self, name, content, size=None):
        handle = tempfile.NamedTemporaryFile(
            "w", delete=False, dir=self.tmp, encoding="utf-8", suffix=Path(name).suffix)
        handle.write(content)
        handle.close()
        path = Path(handle.name)
        return {
            "id": "art-" + name.replace("/", "-"),
            "name": name,
            "path": str(path),
            "size": len(content.encode("utf-8")) if size is None else size,
            "extractedText": content,
        }

    def test_python_and_json_syntax_passes(self):
        rows = [
            self.artifact("src/app.py", "def main():\n    return 1\n"),
            self.artifact("config.json", json.dumps({"ok": True})),
            self.artifact("README.md", "# Delivery\n\nReal documentation with enough content.\n"),
        ]
        report = verification.verify_task({}, rows)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["level"], "syntax")
        self.assertEqual(report["failed"], 0)
        self.assertTrue(all(len(row["sha256"]) == 64 for row in report["fileEvidence"]))
        json.dumps(report)

    def test_syntax_failure_blocks_completion(self):
        report = verification.verify_task({}, [
            self.artifact("src/broken.py", "def main(:\n    pass\n"),
        ])
        self.assertEqual(report["status"], "failed")
        self.assertGreaterEqual(report["failed"], 1)
        self.assertTrue(any("语法" in check["detail"] for check in report["checks"]))

    def test_placeholder_is_rejected(self):
        report = verification.verify_task({}, [
            self.artifact("交付说明.md", "已完成任务并提交交付物。"),
        ])
        self.assertEqual(report["status"], "failed")
        self.assertTrue(any("占位" in check["detail"] for check in report["checks"]))

    def test_missing_file_is_rejected(self):
        row = self.artifact("src/app.py", "print('ok')\n")
        Path(row["path"]).unlink()
        report = verification.verify_task({}, [row])
        self.assertEqual(report["status"], "failed")
        self.assertTrue(any("文件缺失" in check["detail"] for check in report["checks"]))

    def test_documents_are_unverified_not_fake_passed(self):
        report = verification.verify_task({}, [
            self.artifact("notes.md", "# Meeting notes\n\nA real note with enough content.\n"),
        ])
        self.assertEqual(report["status"], "unverified")
        self.assertEqual(report["level"], "presence")

    def test_artifact_diff_reports_real_line_changes(self):
        old = self.artifact("src/app.py", "def main():\n    return 1\n")
        new = self.artifact("src/app.py", "def main():\n    return 2\n    # checked\n")
        added = self.artifact("src/new.py", "VALUE = 2\n")
        diff = verification.artifact_diff([old], [new, added])
        self.assertEqual(diff["changed"], 2)
        self.assertGreaterEqual(diff["added"], 3)
        self.assertGreaterEqual(diff["removed"], 1)
        by_name = {row["name"]: row for row in diff["files"]}
        self.assertEqual(by_name["src/app.py"]["status"], "modified")
        self.assertIn("-    return 1", by_name["src/app.py"]["preview"])
        self.assertIn("+    return 2", by_name["src/app.py"]["preview"])
        self.assertEqual(by_name["src/new.py"]["status"], "added")

    def test_no_artifacts_is_failed(self):
        report = verification.verify_task({}, [])
        self.assertEqual(report["status"], "failed")
        self.assertIn("没有可验证", report["reason"])


if __name__ == "__main__":
    unittest.main()
