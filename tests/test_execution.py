#!/usr/bin/env python3
"""Opt-in sandboxed test execution and its isolation guarantees."""
import os
import socket
import stat
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import execution  # noqa: E402


def make_artifact(name, text):
    fd, raw = tempfile.mkstemp(prefix="ao-exec-test-", suffix=".py")
    os.close(fd)
    path = Path(raw)
    path.write_text(text, encoding="utf-8")
    return {"name": name, "path": str(path), "extractedText": text}


class ExecutionCapabilityTest(unittest.TestCase):
    def test_capabilities_are_explicit(self):
        caps = execution.capabilities()
        self.assertIn(caps["backend"], ("macos-seatbelt", "linux-bwrap", "none"))
        self.assertIn("limitations", caps)
        self.assertEqual(caps["network"], "denied")
        self.assertIn("python-unittest", caps["runners"])

    def test_venv_symlink_runtime_root_is_allowed(self):
        root = Path(tempfile.mkdtemp(prefix="ao_exec_venv_"))
        bin_dir = root / "bin"
        bin_dir.mkdir()
        link = bin_dir / "python"
        try:
            link.symlink_to(sys.executable)
        except OSError:
            self.skipTest("symlinks are not available")
        (root / "pyvenv.cfg").write_text("home = test\n", encoding="utf-8")
        roots = execution._runtime_roots([str(link)])
        self.assertIn(root.resolve(), [Path(item).resolve() for item in roots])

    def test_bubblewrap_command_has_isolation_flags(self):
        command = execution._bwrap_command(
            Path("/tmp/agent-office-workspace"),
            Path("/tmp/agent-office-workspace/runner.sh"),
            ["/usr/bin/python3", "-V"],
            {"HOME": "/workspace", "TMPDIR": "/workspace/.tmp"},
        )
        self.assertIn("--unshare-all", command)
        self.assertIn("--clearenv", command)
        self.assertIn("--ro-bind", command)
        self.assertIn("/tmp", command)
        self.assertIn("--bind", command)
        self.assertIn("/workspace", command)
        self.assertNotIn("--share-net", command)

    @unittest.skipUnless(sys.platform == "darwin", "seatbelt profile is macOS-specific")
    def test_seatbelt_profile_denies_network_and_home(self):
        profile = execution._profile(Path("/tmp/agent-office-workspace"), [])
        self.assertIn("(deny network*)", profile)
        self.assertIn('(subpath "/Users")', profile)
        self.assertIn("(deny default)", profile)
        self.assertIn("(allow process*)", profile)


@unittest.skipUnless(execution.available(), "no supported sandbox backend is available")
class SandboxExecutionTest(unittest.TestCase):
    def test_python_test_passes(self):
        report = execution.run_task_tests({}, [
            make_artifact("files/test/test_ok.py",
                          "import unittest\n"
                          "class T(unittest.TestCase):\n"
                          "    def test_ok(self):\n"
                          "        self.assertEqual(1 + 1, 2)\n"),
        ])
        self.assertTrue(report["sandboxed"])
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["exitCode"], 0)
        self.assertIn("test/test_ok.py", report["tests"])
        self.assertEqual(report["isolation"]["network"], "denied")

    def test_python_test_failure_is_reported(self):
        report = execution.run_task_tests({}, [
            make_artifact("test/test_fail.py",
                          "import unittest\n"
                          "class T(unittest.TestCase):\n"
                          "    def test_fail(self):\n"
                          "        self.assertEqual(1, 2)\n"),
        ])
        self.assertTrue(report["sandboxed"])
        self.assertEqual(report["status"], "failed")
        self.assertNotEqual(report["exitCode"], 0)
        self.assertTrue(report["output"])

    def test_no_python_tests_is_skipped(self):
        report = execution.run_task_tests({}, [
            make_artifact("README.md", "# no tests\n"),
        ])
        self.assertEqual(report["status"], "skipped")
        self.assertIn("未发现", report["reason"])

    def test_network_is_denied(self):
        report = execution.run_task_tests({}, [
            make_artifact("test/test_network.py",
                          "import socket\n"
                          "import unittest\n"
                          "class T(unittest.TestCase):\n"
                          "    def test_network(self):\n"
                          "        with self.assertRaises(OSError):\n"
                          "            socket.create_connection(('1.1.1.1', 80), timeout=1)\n"),
        ])
        self.assertEqual(report["status"], "passed", report["output"][-1500:])

    def test_home_directory_is_not_readable(self):
        home = str(Path.home())
        report = execution.run_task_tests({}, [
            make_artifact("test/test_home.py",
                          "import os\n"
                          "import unittest\n"
                          "class T(unittest.TestCase):\n"
                          "    def test_home(self):\n"
                          "        with self.assertRaises((PermissionError, FileNotFoundError)):\n"
                          "            os.listdir(%r)\n" % home),
        ])
        self.assertEqual(report["status"], "passed", report["output"][-1500:])

    def test_writes_outside_workspace_are_denied(self):
        escape = "/tmp/ao-executor-escape-" + str(os.getpid())
        try:
            report = execution.run_task_tests({}, [
                make_artifact("test/test_write.py",
                              "import unittest\n"
                              "class T(unittest.TestCase):\n"
                              "    def test_write(self):\n"
                              "        with self.assertRaises(OSError):\n"
                              "            open(%r, 'w').write('escape')\n" % escape),
            ])
            self.assertEqual(report["status"], "passed", report["output"][-1500:])
            self.assertFalse(Path(escape).exists())
        finally:
            try:
                Path(escape).unlink()
            except OSError:
                pass

    def test_host_environment_secrets_are_not_inherited(self):
        previous = os.environ.get("AO_EXECUTOR_SECRET")
        os.environ["AO_EXECUTOR_SECRET"] = "should-not-leak"
        try:
            report = execution.run_task_tests({}, [
                make_artifact("test/test_env.py",
                              "import os\n"
                              "import unittest\n"
                              "class T(unittest.TestCase):\n"
                              "    def test_env(self):\n"
                              "        self.assertNotIn('AO_EXECUTOR_SECRET', os.environ)\n"
                              "        self.assertTrue(os.environ.get('PATH'))\n"),
            ])
            self.assertEqual(report["status"], "passed", report["output"][-1500:])
        finally:
            if previous is None:
                os.environ.pop("AO_EXECUTOR_SECRET", None)
            else:
                os.environ["AO_EXECUTOR_SECRET"] = previous

    def test_timeout_kills_the_process_group(self):
        report = execution.run_task_tests({}, [
            make_artifact("test/test_slow.py",
                          "import time\n"
                          "import unittest\n"
                          "class T(unittest.TestCase):\n"
                          "    def test_slow(self):\n"
                          "        time.sleep(5)\n"),
        ], timeout_seconds=1)
        self.assertEqual(report["status"], "failed")
        self.assertTrue(report["timedOut"])
        self.assertLess(report["durationMs"], 5000)

    def test_output_is_bounded(self):
        report = execution.run_task_tests({}, [
            make_artifact("test/test_loud.py",
                          "import unittest\n"
                          "class T(unittest.TestCase):\n"
                          "    def test_loud(self):\n"
                          "        print('x' * 200000)\n"),
        ])
        self.assertEqual(report["status"], "passed")
        self.assertTrue(report["outputTruncated"])
        self.assertLessEqual(len(report["output"]), execution.MAX_OUTPUT)

    def test_traversal_name_is_rejected(self):
        report = execution.run_task_tests({}, [
            make_artifact("../evil.py",
                          "import unittest\n"
                          "class T(unittest.TestCase):\n"
                          "    def test_ok(self):\n"
                          "        self.assertTrue(True)\n"),
        ])
        self.assertEqual(report["status"], "skipped")
        self.assertEqual(report["files"], 0)

    def test_source_outside_allowed_root_is_rejected(self):
        root = Path(tempfile.mkdtemp(prefix="ao_exec_root_"))
        report = execution.run_task_tests({}, [
            {"name": "test/passwd.py", "path": "/etc/passwd"},
        ], allowed_root=root)
        self.assertEqual(report["status"], "skipped")
        self.assertEqual(report["files"], 0)

    def test_symlink_artifact_is_rejected(self):
        target = Path(tempfile.mkstemp(prefix="ao-exec-link-target-")[1])
        target.write_text("import unittest\n", encoding="utf-8")
        link = target.with_name(target.name + "-link.py")
        try:
            link.symlink_to(target)
        except OSError:
            self.skipTest("symlinks are not available")
        try:
            report = execution.run_task_tests({}, [
                {"name": "test/test_link.py", "path": str(link)},
            ])
            self.assertEqual(report["status"], "skipped")
            self.assertEqual(report["files"], 0)
        finally:
            try:
                link.unlink()
            except OSError:
                pass
            try:
                target.unlink()
            except OSError:
                pass

    def test_custom_command_runs_inside_sandbox(self):
        report = execution.run_task_tests({}, [
            make_artifact("test/test_ok.py",
                          "import unittest\n"
                          "class T(unittest.TestCase):\n"
                          "    def test_ok(self):\n"
                          "        self.assertTrue(True)\n"),
        ], command="python3 -c \"print('custom-ok')\"")
        self.assertEqual(report["status"], "passed", report["output"][-1500:])
        self.assertEqual(report["runner"], "custom")
        self.assertIn("custom-ok", report["output"])
        self.assertTrue(report["sandboxed"])

    def test_disallowed_custom_command_is_not_run(self):
        report = execution.run_task_tests({}, [
            make_artifact("test/test_ok.py",
                          "import unittest\n"
                          "class T(unittest.TestCase):\n"
                          "    def test_ok(self):\n"
                          "        self.assertTrue(True)\n"),
        ], command="/bin/echo unsafe")
        self.assertEqual(report["status"], "skipped")
        self.assertIn("PATH", report["reason"])

    def test_node_test_runner_when_available(self):
        caps = execution.capabilities()
        if not caps["runtimes"]["node"]["testRunner"]:
            self.skipTest("Node.js >= 18 is not installed")
        report = execution.run_task_tests({}, [
            make_artifact("test/math.test.js",
                          "const test = require('node:test');\n"
                          "const assert = require('node:assert');\n"
                          "test('math', () => assert.equal(1 + 1, 2));\n"),
        ])
        self.assertEqual(report["status"], "passed", report["output"][-1500:])
        self.assertEqual(report["runner"], "node-test")
        self.assertGreaterEqual(report["counts"].get("tests", 0), 1)


if __name__ == "__main__":
    unittest.main()
