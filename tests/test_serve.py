"""Black-box tests for the static server whitelist (security review P0-4)."""
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SERVE = REPO_ROOT / "serve.py"


def free_port():
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ServeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = free_port()
        cls.base = "http://127.0.0.1:%d" % cls.port
        cls.proc = subprocess.Popen(
            [sys.executable, "-I", str(SERVE), str(cls.port)],
            cwd=str(REPO_ROOT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(cls.base + "/", timeout=1):
                    return
            except (urllib.error.URLError, ConnectionError, OSError):
                time.sleep(0.1)
        cls.proc.terminate()
        raise RuntimeError("static server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.proc.kill()

    def status(self, path):
        try:
            with urllib.request.urlopen(self.base + path, timeout=5) as res:
                res.read()
                return res.status
        except urllib.error.HTTPError as exc:
            exc.read()
            return exc.code

    def test_app_assets_are_served(self):
        for path in ("/", "/index.html", "/src/main.js", "/styles.css",
                     "/site.webmanifest", "/assets/brand/favicon-32.png"):
            self.assertEqual(self.status(path), 200, path)

    def test_source_and_secret_paths_are_hidden(self):
        for path in ("/bridge.py", "/serve.py", "/start.sh", "/README.md",
                     "/providers.example.json", "/.git/HEAD", "/.gitignore",
                     "/tests/test_bridge.py", "/scripts/eval_phase1.py",
                     "/dev-external.html", "/docs/MCP.md", "/VERSION"):
            self.assertEqual(self.status(path), 404, path)


if __name__ == "__main__":
    unittest.main()
