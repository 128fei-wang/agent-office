#!/usr/bin/env python3
"""Unit tests for updater.py. Standard library only."""
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import updater  # noqa: E402


def write_app(root, version):
    files = {
        "VERSION": version + "\n",
        "index.html": "index " + version + "\n",
        "bridge.py": "print('bridge " + version + "')\n",
        "start.sh": "#!/bin/sh\necho start\n",
        "src/main.js": "// main " + version + "\n",
        "updater.py": "print('updater " + version + "')\n",
        "update.sh": "#!/bin/sh\necho update\n",
        "src/update.js": "// update " + version + "\n",
        "update.css": "/* update " + version + " */\n",
    }
    for rel, text in files.items():
        path = Path(root) / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, "utf-8")


def make_archive(folder, version):
    source = Path(folder) / ("agent-office-" + version)
    if source.exists():
        shutil.rmtree(source)
    source.mkdir(parents=True)
    write_app(source, version)
    archive = Path(folder) / ("agent-office-" + version + ".tar.gz")
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(source, arcname=source.name)
    return archive


def release(version):
    return {
        "version": version,
        "tag": "v" + version,
        "name": "Agent Office v" + version,
        "notes": "notes " + version,
        "url": "https://example.test/releases/v" + version,
        "tarballUrl": "https://example.test/v" + version + ".tar.gz",
        "publishedAt": "2026-11-25T00:00:00Z",
    }


class TarHandler(BaseHTTPRequestHandler):
    payload = b""

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.path != "/release.tar.gz":
            self.send_response(404)
            self.end_headers()
            return
        if self.headers.get("Accept") == "application/octet-stream":
            self.send_response(415)
            self.end_headers()
            return
        body = self.payload
        self.send_response(200)
        self.send_header("Content-Type", "application/gzip")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class UpdaterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ao-updater-test-"))
        self.app = self.tmp / "app"
        self.app.mkdir()
        write_app(self.app, "1.2.0")
        self.backups = self.tmp / "backups"
        self.state = self.tmp / "state"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_version_compare(self):
        self.assertEqual(updater.compare_versions("1.3.0", "1.2.0"), 1)
        self.assertEqual(updater.compare_versions("v1.2.0", "1.2.0"), 0)
        self.assertEqual(updater.compare_versions("1.2.0", "1.3.0"), -1)
        self.assertEqual(updater.compare_versions("1.3.0-beta.1", "1.3.0"), -1)
        self.assertIsNone(updater.parse_version("main"))

    def test_check_archive_available(self):
        status = updater.check_for_update(
            app_root=self.app, release=release("1.3.0"), force=True,
            mode="archive", backup_dir=self.backups,
        )
        self.assertEqual(status["currentVersion"], "1.2.0")
        self.assertEqual(status["latestVersion"], "1.3.0")
        self.assertTrue(status["updateAvailable"])
        self.assertEqual(status["deployment"]["mode"], "archive")
        self.assertTrue(status["deployment"]["canApply"])

    def test_check_no_update(self):
        status = updater.check_for_update(
            app_root=self.app, release=release("1.2.0"), force=True,
            mode="archive", backup_dir=self.backups,
        )
        self.assertFalse(status["updateAvailable"])
        self.assertEqual(status["deployment"]["reason"], "no_update")

    def test_apply_archive_and_rollback(self):
        archive = make_archive(self.tmp / "new", "1.3.0")
        stages = []
        result = updater.apply_update(
            target_version="1.3.0", release=release("1.3.0"),
            app_root=self.app, backup_dir=self.backups,
            archive_path=archive, mode="archive", state_dir=self.state,
            progress=lambda stage, percent, message: stages.append(stage),
        )
        self.assertTrue(result["ok"])
        self.assertEqual((self.app / "VERSION").read_text().strip(), "1.3.0")
        self.assertEqual((self.app / "index.html").read_text().strip(), "index 1.3.0")
        self.assertIn("backup", stages)
        backups = updater.list_backups(self.backups)
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0]["version"], "1.2.0")
        self.assertEqual(updater.last_update(self.state)["status"], "updated")

        rollback = updater.rollback_last(
            app_root=self.app, backup_dir=self.backups, state_dir=self.state,
        )
        self.assertTrue(rollback["ok"])
        self.assertEqual(rollback["toVersion"], "1.2.0")
        self.assertEqual((self.app / "VERSION").read_text().strip(), "1.2.0")
        self.assertEqual((self.app / "index.html").read_text().strip(), "index 1.2.0")
        self.assertEqual(updater.last_update(self.state)["status"], "rolled_back")

    def test_apply_downloads_archive(self):
        archive = make_archive(self.tmp / "download", "1.3.0")
        TarHandler.payload = archive.read_bytes()
        server = ThreadingHTTPServer(("127.0.0.1", 0), TarHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            rel = release("1.3.0")
            rel["tarballUrl"] = "http://127.0.0.1:%d/release.tar.gz" % server.server_address[1]
            result = updater.apply_update(
                target_version="1.3.0", release=rel,
                app_root=self.app, backup_dir=self.backups,
                mode="archive", state_dir=self.state,
            )
            self.assertTrue(result["ok"])
            self.assertEqual((self.app / "VERSION").read_text().strip(), "1.3.0")
        finally:
            server.shutdown()
            server.server_close()

    def test_rollback_candidate_skips_current_version(self):
        first = updater.create_backup(self.app, self.backups, version="1.2.0")
        second = updater.create_backup(self.app, self.backups, version="1.3.0")
        self.assertNotEqual(first["id"], second["id"])
        candidate = updater.rollback_candidate(self.backups, "1.3.0")
        self.assertEqual(candidate["version"], "1.2.0")
        self.assertEqual(
            updater.rollback_candidate(self.backups, "1.2.0")["version"], "1.3.0"
        )
        only = self.tmp / "only-backups"
        updater.create_backup(self.app, only, version="1.3.0")
        self.assertIsNone(updater.rollback_candidate(only, "1.3.0"))

    def test_version_mismatch_rolls_back(self):
        archive = make_archive(self.tmp / "bad", "1.2.1")
        with self.assertRaises(updater.UpdateError):
            updater.apply_update(
                target_version="1.3.0", release=release("1.3.0"),
                app_root=self.app, backup_dir=self.backups,
                archive_path=archive, mode="archive", state_dir=self.state,
            )
        self.assertEqual((self.app / "VERSION").read_text().strip(), "1.2.0")

    def test_archive_rejects_traversal(self):
        archive = self.tmp / "evil.tar.gz"
        payload = b"owned"
        with tarfile.open(archive, "w:gz") as tar:
            info = tarfile.TarInfo("../outside.txt")
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
        with self.assertRaises(updater.UpdateError):
            updater._safe_extract(archive, self.tmp / "extract")
        self.assertFalse((self.tmp / "outside.txt").exists())

    def test_archive_rejects_symlink(self):
        archive = self.tmp / "link.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            info = tarfile.TarInfo("root/link")
            info.type = tarfile.SYMTYPE
            info.linkname = "/etc/passwd"
            tar.addfile(info)
        with self.assertRaises(updater.UpdateError):
            updater._safe_extract(archive, self.tmp / "extract")

    def _git_env(self):
        return {
            **os.environ,
            "GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "test@example.com",
            "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "test@example.com",
        }

    def _git(self, cwd, *args):
        subprocess.run(["git", *args], cwd=str(cwd), check=True,
                       env=self._git_env(), stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_git_dirty_blocks_update(self):
        self._git(self.app, "init", "-q", "-b", "main")
        self._git(self.app, "add", ".")
        self._git(self.app, "commit", "-qm", "initial")
        (self.app / "index.html").write_text("local edit\n", "utf-8")
        status = updater.check_for_update(
            app_root=self.app, release=release("1.3.0"), force=True,
            mode="git", backup_dir=self.backups,
        )
        self.assertEqual(status["deployment"]["mode"], "git")
        self.assertFalse(status["deployment"]["canApply"])
        self.assertEqual(status["deployment"]["reason"], "git_dirty")

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_git_apply_and_rollback(self):
        remote = self.tmp / "remote.git"
        seed = self.tmp / "seed"
        local = self.tmp / "local"
        self._git(self.tmp, "init", "-q", "--bare", "-b", "main", str(remote))
        seed.mkdir()
        write_app(seed, "1.2.0")
        self._git(seed, "init", "-q", "-b", "main")
        self._git(seed, "add", ".")
        self._git(seed, "commit", "-qm", "v1.2.0")
        self._git(seed, "remote", "add", "origin", str(remote))
        self._git(seed, "push", "-q", "-u", "origin", "main")
        self._git(self.tmp, "clone", "-q", str(remote), str(local))

        write_app(seed, "1.3.0")
        self._git(seed, "add", ".")
        self._git(seed, "commit", "-qm", "v1.3.0")
        self._git(seed, "push", "-q", "origin", "main")

        result = updater.apply_update(
            target_version="1.3.0", release=release("1.3.0"),
            app_root=local, backup_dir=self.backups,
            mode="git", state_dir=self.state,
        )
        self.assertTrue(result["ok"])
        self.assertEqual((local / "VERSION").read_text().strip(), "1.3.0")
        self.assertEqual((local / "index.html").read_text().strip(), "index 1.3.0")

        rollback = updater.rollback_last(
            app_root=local, backup_dir=self.backups, state_dir=self.state,
        )
        self.assertEqual(rollback["toVersion"], "1.2.0")
        self.assertEqual((local / "VERSION").read_text().strip(), "1.2.0")


if __name__ == "__main__":
    unittest.main()
