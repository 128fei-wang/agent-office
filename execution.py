#!/usr/bin/env python3
"""Opt-in sandboxed test execution for generated deliverables.

Security rules for this module:

* A supported sandbox backend is mandatory. If none is available, the task is
  reported as ``unavailable`` and is never executed without a sandbox.
* Test code runs against a throw-away copy of task artifacts in a temporary
  workspace. The original upload directory is never mounted or written.
* Network access is denied. The user's home directory is not readable (except
  an explicitly required runtime installation), host environment secrets are
  not inherited, only the workspace is writable, output is bounded, and the
  whole process group is killed on timeout.
* Supported backends are macOS seatbelt (``sandbox-exec``) and Linux
  bubblewrap (``bwrap``). Windows has no supported backend in this version and
  is reported as unavailable instead of silently running unsandboxed.

This is a process-level sandbox, not a virtual machine. It is appropriate for
running generated unit tests, not for untrusted production workloads.
"""
from __future__ import annotations

import collections
import datetime
import importlib.util
import json
import os
import re
import secrets
import selectors
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

VERSION = "agent-office-executor/2"
SANDBOX_EXEC = Path("/usr/bin/sandbox-exec")
BWRAP = shutil.which("bwrap") or ""
TIMEOUT_SECONDS = 45
MAX_TIMEOUT_SECONDS = 120
MAX_OUTPUT = 24000
MAX_FILES = 200
MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_TOTAL_BYTES = 20 * 1024 * 1024
MAX_COMMAND_CHARS = 300
MAX_COMMAND_ARGS = 32
GENESIS = "agent-office.executor.workspace"


def _now():
    return datetime.datetime.now(datetime.timezone.utc).replace(
        microsecond=0).isoformat().replace("+00:00", "Z")


def _which(name):
    try:
        return shutil.which(str(name or "")) or ""
    except (OSError, ValueError):
        return ""


def backend():
    """Return the active sandbox backend name, or an empty string."""
    if sys.platform == "darwin" and SANDBOX_EXEC.is_file():
        return "macos-seatbelt"
    if sys.platform.startswith("linux") and BWRAP:
        return "linux-bwrap"
    return ""


def _bwrap_preflight():
    if not BWRAP:
        return False
    try:
        result = subprocess.run(
            [BWRAP, "--die-with-parent", "--unshare-all", "--ro-bind", "/", "/",
             "/usr/bin/true"],
            capture_output=True, text=True, timeout=4,
            env={"PATH": "/usr/bin:/bin", "HOME": tempfile.gettempdir()},
            stdin=subprocess.DEVNULL,
        )
        return result.returncode == 0
    except (OSError, subprocess.SubprocessError, ValueError):
        return False


def available():
    if hasattr(available, "cached"):
        return bool(available.cached)
    be = backend()
    if be == "linux-bwrap":
        available.cached = _bwrap_preflight()
    else:
        available.cached = bool(be)
    return bool(available.cached)


def _runtime_roots(executables):
    """Runtime roots that need a narrow read exception in seatbelt.

    This includes home runtimes (pyenv/nvm/venv) and throw-away venvs under
    /tmp. System roots are already readable through the root rule and are
    skipped so a /bin/bash runtime cannot accidentally allow "/".
    """
    roots = []
    blocked_roots = {Path("/"), Path("/usr"), Path("/bin"), Path("/sbin"),
                     Path("/System"), Path("/Library")}
    for executable in executables:
        if not executable:
            continue
        try:
            real = Path(executable).resolve()
            candidates = [Path(executable).absolute(), real]
        except OSError:
            candidates = [Path(executable).absolute()]
        for candidate in candidates:
            root = (candidate.parent.parent if candidate.parent.name == "bin"
                    else candidate.parent)
            if root in blocked_roots or root in roots:
                continue
            roots.append(root)
    return roots


def _home_runtime_roots(executables):
    home = Path.home().resolve()
    roots = []
    for root in _runtime_roots(executables):
        try:
            root.relative_to(home)
        except ValueError:
            continue
        if root not in roots:
            roots.append(root)
    return roots


def _node_version():
    if hasattr(_node_version, "cached"):
        return _node_version.cached
    node = _which("node")
    if not node:
        _node_version.cached = ""
        return ""
    try:
        env = {
            "PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
            "HOME": tempfile.gettempdir(),
            "NO_COLOR": "1",
        }
        result = subprocess.run(
            [node, "--version"], capture_output=True, text=True,
            timeout=3, env=env, stdin=subprocess.DEVNULL,
        )
        _node_version.cached = (result.stdout or "").strip()
    except (OSError, subprocess.SubprocessError, ValueError):
        _node_version.cached = ""
    return _node_version.cached


def _node_major(version):
    match = re.search(r"v?(\d+)", str(version or ""))
    return int(match.group(1)) if match else 0


def _pytest_available():
    if hasattr(_pytest_available, "cached"):
        return bool(_pytest_available.cached)
    if importlib.util.find_spec("pytest") is None:
        _pytest_available.cached = False
        return False
    try:
        env = {
            "PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
            "HOME": tempfile.gettempdir(),
            "PYTHONNOUSERSITE": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        result = subprocess.run(
            [sys.executable, "-c", "import pytest"],
            capture_output=True, text=True, timeout=5, env=env,
            stdin=subprocess.DEVNULL,
        )
        _pytest_available.cached = result.returncode == 0
    except (OSError, subprocess.SubprocessError, ValueError):
        _pytest_available.cached = False
    return bool(_pytest_available.cached)


def capabilities():
    be = backend()
    node = _which("node")
    node_version = _node_version()
    test_node = bool(node) and _node_major(node_version) >= 18
    pytest_ok = _pytest_available()
    limitations = [
        "进程级沙箱，不等同于虚拟机；不应用于运行不可信的生产服务或密钥。",
        "不安装依赖、不访问网络；需要下载依赖的项目会在沙箱内失败。",
    ]
    if not be:
        limitations.insert(0, "当前平台没有受支持的沙箱后端，测试不会执行。")
    if sys.platform.startswith("win"):
        limitations.insert(0, "Windows 暂无受支持的沙箱后端；不会降级为无沙箱执行。")
    if be == "linux-bwrap" and _home_runtime_roots([sys.executable, node]):
        limitations.append("Linux bubblewrap 下运行时装在用户目录，为避免暴露 home，测试不会执行。")
    if be == "linux-bwrap" and not available():
        limitations.insert(0, "bubblewrap 已安装但无法创建用户命名空间；测试不会执行。")
    if not node:
        limitations.append("未检测到 Node.js，Node 测试不会执行。")
    elif not test_node:
        limitations.append("Node.js 版本低于 18，不支持 node --test。")
    if not pytest_ok:
        limitations.append("未检测到 pytest，pytest 风格测试不会执行；unittest 仍可用。")
    return {
        "version": VERSION,
        "platform": sys.platform,
        "backend": be or "none",
        "available": available(),
        "sandboxed": available(),
        "network": "denied",
        "homeRead": "denied" if be else "not-run",
        "workspaceWrites": "only" if be else "not-run",
        "runtimes": {
            "python": {"available": True, "version": sys.version.split()[0]},
            "pytest": {"available": pytest_ok},
            "node": {
                "available": bool(node), "version": node_version,
                "testRunner": test_node,
            },
            "npm": {"available": bool(_which("npm"))},
        },
        "runners": ["custom", "python-unittest", "python-pytest", "node-test"],
        "limits": {
            "timeoutSeconds": TIMEOUT_SECONDS,
            "maxOutputBytes": MAX_OUTPUT,
            "maxFiles": MAX_FILES,
            "maxFileBytes": MAX_FILE_BYTES,
            "maxTotalBytes": MAX_TOTAL_BYTES,
        },
        "limitations": limitations,
    }


def _safe_member(name):
    rel = str(name or "deliverable").replace("\\", "/")
    if rel.startswith("files/"):
        rel = rel[6:]
    rel = rel.lstrip("/")
    parts = [part for part in rel.split("/") if part not in ("", ".")]
    if not parts or any(part == ".." for part in parts):
        return ""
    if any("\x00" in part or "\n" in part or "\r" in part or ":" in part
           for part in parts):
        return ""
    joined = "/".join(parts)
    if len(joined) > 240:
        return ""
    return joined


def _within(path, root):
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _materialize(artifacts, workspace, allowed_root=None):
    result = {"files": 0, "bytes": 0, "skipped": 0}
    used = set()
    root = None
    if allowed_root:
        try:
            root = Path(allowed_root).resolve()
        except OSError:
            root = None
    for artifact in artifacts or []:
        if not isinstance(artifact, dict):
            result["skipped"] += 1
            continue
        member = _safe_member(artifact.get("name"))
        if not member or member in used:
            result["skipped"] += 1
            continue
        dest = workspace / member
        source = Path(str(artifact.get("path") or ""))
        content = ""
        if source:
            try:
                if source.is_symlink():
                    result["skipped"] += 1
                    continue
                real = source.resolve()
                if root is not None and not _within(real, root):
                    result["skipped"] += 1
                    continue
                info = real.stat()
                if not stat.S_ISREG(info.st_mode):
                    result["skipped"] += 1
                    continue
                if info.st_size > MAX_FILE_BYTES:
                    result["skipped"] += 1
                    continue
                if result["bytes"] + info.st_size > MAX_TOTAL_BYTES:
                    result["skipped"] += 1
                    continue
                source = real
            except (OSError, ValueError):
                result["skipped"] += 1
                continue
        else:
            content = str(artifact.get("extractedText") or "")
            if not content.strip():
                result["skipped"] += 1
                continue
            encoded = content.encode("utf-8")
            if len(encoded) > MAX_FILE_BYTES:
                result["skipped"] += 1
                continue
            if result["bytes"] + len(encoded) > MAX_TOTAL_BYTES:
                result["skipped"] += 1
                continue
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            if result["files"] >= MAX_FILES:
                result["skipped"] += 1
                continue
            if source:
                shutil.copyfile(str(source), str(dest))
                result["bytes"] += int(dest.stat().st_size)
            else:
                dest.write_text(content, encoding="utf-8")
                result["bytes"] += len(content.encode("utf-8"))
            used.add(member)
            result["files"] += 1
        except OSError:
            result["skipped"] += 1
            continue
    return result


def _profile(workspace, runtime_roots):
    home = Path.home().resolve()
    quoted = lambda value: json.dumps(str(value))
    rules = [
        "(version 1)",
        "(deny default)",
        "(allow process*)",
        "(allow sysctl-read)",
        "(allow mach-lookup)",
        "(allow ipc-posix*)",
        "(allow file-read-metadata)",
        '(allow file-read* (subpath "/"))',
        '(deny file-read* (subpath "/Users") (subpath "/Volumes") '
        '(subpath "/private/var/root") (subpath "/private/var/folders") '
        '(subpath "/private/tmp"))',
    ]
    if not _within(home, Path("/Users")):
        rules.append("(deny file-read* (subpath %s))" % quoted(home))
    for root in runtime_roots:
        rules.append("(allow file-read* (subpath %s))" % quoted(root))
    rules.extend([
        "(allow file-read* (subpath %s))" % quoted(workspace),
        "(allow file-write* (subpath %s) (literal \"/dev/null\"))" % quoted(workspace),
        "(deny network*)",
    ])
    return "\n".join(rules) + "\n"


def _runner_script(workspace, timeout_seconds):
    script = workspace / (".agent-office-runner-" + secrets.token_hex(4) + ".sh")
    script.write_text(
        "#!/bin/sh\n"
        "ulimit -t %d 2>/dev/null || true\n"
        "ulimit -f 20480 2>/dev/null || true\n"
        "ulimit -v 2097152 2>/dev/null || true\n"
        "ulimit -n 64 2>/dev/null || true\n"
        'exec "$@"\n' % max(1, int(timeout_seconds)),
        encoding="utf-8",
    )
    try:
        script.chmod(0o700)
    except OSError:
        pass
    return script


def _runtime_dirs(executables):
    dirs = []
    for executable in executables:
        if not executable:
            continue
        try:
            directory = str(Path(executable).resolve().parent)
        except OSError:
            continue
        if directory and directory != "." and directory not in dirs:
            dirs.append(directory)
    return dirs


def _minimal_env(workspace, runtime_dirs=None):
    path_parts = []
    for item in list(runtime_dirs or []) + [
        "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin",
        "/usr/sbin", "/sbin",
    ]:
        if item and item != "." and item not in path_parts:
            path_parts.append(str(item))
    return {
        "PATH": ":".join(path_parts),
        "HOME": str(workspace),
        "TMPDIR": str(workspace / ".tmp"),
        "TMP": str(workspace / ".tmp"),
        "TEMP": str(workspace / ".tmp"),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PYTHONPATH": str(workspace),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
        "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
        "NO_COLOR": "1",
        "npm_config_cache": str(workspace / ".npm"),
        "npm_config_offline": "true",
        "npm_config_audit": "false",
        "npm_config_fund": "false",
    }


def _bwrap_command(workspace, runner, argv, env):
    command = [
        BWRAP, "--die-with-parent", "--new-session", "--unshare-all",
        "--cap-drop", "ALL", "--clearenv",
    ]
    for path in ("/usr", "/bin", "/lib", "/lib64", "/usr/local", "/opt"):
        command += ["--ro-bind-try", path, path]
    for path in (
        "/etc/ld.so.cache", "/etc/alternatives", "/etc/passwd", "/etc/group",
        "/etc/nsswitch.conf", "/etc/localtime", "/etc/timezone",
    ):
        command += ["--ro-bind-try", path, path]
    command += ["--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp"]
    command += ["--bind", str(workspace), "/workspace", "--chdir", "/workspace"]
    for key, value in env.items():
        command += ["--setenv", str(key), str(value)]
    command += ["--", "/bin/sh", "/workspace/" + Path(runner).name] + list(argv)
    return command


def _command_display(argv):
    parts = [str(item) for item in argv]
    if parts:
        try:
            if Path(parts[0]).resolve() == Path(sys.executable).resolve():
                parts[0] = "python"
        except OSError:
            pass
    try:
        return " ".join(shlex.quote(part) for part in parts)[:MAX_COMMAND_CHARS]
    except (TypeError, ValueError):
        return " ".join(parts)[:MAX_COMMAND_CHARS]


def _custom_command(text):
    raw = str(text or "").strip()
    if not raw:
        return None, "empty"
    if len(raw) > MAX_COMMAND_CHARS or any(ch in raw for ch in ("\x00", "\n", "\r")):
        return None, "命令过长或包含换行/空字符"
    try:
        parts = shlex.split(raw, posix=True)
    except ValueError as exc:
        return None, "命令无法解析：" + str(exc)[:100]
    if not parts or len(parts) > MAX_COMMAND_ARGS:
        return None, "命令为空或参数过多"
    executable = parts[0]
    if "/" in executable or "\\" in executable or "=" in executable:
        return None, "自定义命令只允许使用 PATH 中的可执行文件"
    name = Path(executable).name.lower()
    allowed = re.fullmatch(
        r"(python(3(\.\d+)?)?|pytest|node|npm|npx|bun|deno|go|cargo|ruby|php|"
        r"java|dotnet|swift|make|bash|sh|zsh)", name)
    if not allowed:
        return None, "不允许执行该命令：" + name
    if name in ("python", "python3") and Path(sys.executable).is_file():
        path = sys.executable
    else:
        path = _which(executable)
    if not path:
        return None, "找不到命令：" + executable
    return [path] + parts[1:], ""


def _python_test_files(workspace):
    files = []
    for path in sorted(workspace.rglob("*.py")):
        if "__pycache__" in path.parts or ".tmp" in path.parts:
            continue
        if path.name.startswith("test") or path.name.endswith("_test.py"):
            files.append(path)
    return files


def _read_head(path):
    try:
        return path.read_text("utf-8", errors="replace")[:24000]
    except OSError:
        return ""


def _python_style(files):
    unittest_style = False
    pytest_style = False
    for path in files:
        text = _read_head(path)
        if re.search(r"(?m)^\s*(import unittest|from unittest|class\s+\w+\s*\([^)]*TestCase)",
                     text):
            unittest_style = True
        if re.search(r"(?m)^\s*(import pytest|from pytest|@pytest\.)", text):
            pytest_style = True
        if not unittest_style and re.search(r"(?m)^\s*def test_\w+\s*\(", text):
            pytest_style = True
    return unittest_style, pytest_style


def _node_test_files(workspace):
    files = []
    for path in sorted(workspace.rglob("*")):
        if not path.is_file() or "node_modules" in path.parts:
            continue
        name = path.name.lower()
        if name.endswith((".test.js", ".test.mjs", ".test.cjs", ".spec.js",
                          ".spec.mjs", ".spec.cjs")):
            files.append(path)
        elif path.parent.name in ("test", "tests") and name.endswith((".js", ".mjs", ".cjs")):
            files.append(path)
    return files


def _prepare_runner(workspace, requested_command):
    if requested_command:
        argv, error = _custom_command(requested_command)
        if not argv:
            return None, "custom", [], error or "自定义命令不可用"
        return argv, "custom", [], ""
    python_files = _python_test_files(workspace)
    if python_files:
        unittest_style, pytest_style = _python_style(python_files)
        if _pytest_available():
            for path in python_files:
                parent = path.parent
                while parent != workspace and workspace in parent.parents:
                    init = parent / "__init__.py"
                    if not init.exists():
                        try:
                            init.write_text("", encoding="utf-8")
                        except OSError:
                            pass
                    parent = parent.parent
            relative = [str(path.relative_to(workspace)) for path in python_files]
            return ([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider"] + relative,
                    "python-pytest", relative, "")
        if unittest_style:
            for path in python_files:
                parent = path.parent
                while parent != workspace and workspace in parent.parents:
                    init = parent / "__init__.py"
                    if not init.exists():
                        try:
                            init.write_text("", encoding="utf-8")
                        except OSError:
                            pass
                    parent = parent.parent
            relative = [str(path.relative_to(workspace)) for path in python_files]
            return ([sys.executable, "-m", "unittest", "discover", "-s",
                     str(workspace), "-p", "test*.py", "-v"],
                    "python-unittest", relative, "")
        if pytest_style:
            return None, "python-pytest", [], "检测到 pytest 风格测试，但沙箱 Python 未安装 pytest；未执行"
    node_files = _node_test_files(workspace)
    if node_files:
        node = _which("node")
        version = _node_version()
        if not node:
            return None, "node-test", [], "未检测到 Node.js；未执行"
        if _node_major(version) < 18:
            return None, "node-test", [], "Node.js 版本低于 18，不支持 node --test；未执行"
        relative = [str(path.relative_to(workspace)) for path in node_files]
        return ([node, "--test"] + relative, "node-test", relative, "")
    return None, "", [], "未发现可执行的测试文件（Python test*.py / *_test.py 或 Node *.test.js）"


def _kill_group(proc):
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (OSError, ProcessLookupError):
        try:
            proc.kill()
        except OSError:
            pass


def _run_bounded(argv, cwd, env, timeout_seconds):
    proc = subprocess.Popen(
        argv, cwd=str(cwd), env=env, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        start_new_session=True, close_fds=True,
    )
    selector = selectors.DefaultSelector()
    selector.register(proc.stdout, selectors.EVENT_READ, "stdout")
    selector.register(proc.stderr, selectors.EVENT_READ, "stderr")
    chunks = collections.deque()
    total = 0
    truncated = False
    timed_out = False
    deadline = time.monotonic() + max(1, int(timeout_seconds))
    try:
        while True:
            if time.monotonic() > deadline:
                timed_out = True
                _kill_group(proc)
                break
            events = selector.select(0.05)
            for key, _ in events:
                try:
                    data = os.read(key.fd, 8192)
                except OSError:
                    data = b""
                if not data:
                    try:
                        selector.unregister(key.fileobj)
                    except (KeyError, ValueError):
                        pass
                    continue
                chunks.append(data)
                total += len(data)
                while total > MAX_OUTPUT and chunks:
                    dropped = chunks.popleft()
                    total -= len(dropped)
                    truncated = True
            if not selector.get_map():
                break
            if proc.poll() is not None and not events:
                # Give the pipe a short window to flush after exit.
                if not selector.get_map():
                    break
    finally:
        try:
            selector.close()
        except Exception:
            pass
    if proc.poll() is None:
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            _kill_group(proc)
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
    for stream in (proc.stdout, proc.stderr):
        try:
            if stream:
                stream.close()
        except OSError:
            pass
    output = b"".join(chunks).decode("utf-8", errors="replace")
    return {
        "exitCode": None if timed_out else proc.returncode,
        "output": output[-MAX_OUTPUT:],
        "truncated": truncated,
        "timedOut": timed_out,
    }


def _parse_counts(runner, output):
    counts = {}
    if runner == "python-unittest":
        match = re.search(r"Ran (\d+) tests?", output)
        if match:
            counts["tests"] = int(match.group(1))
    elif runner == "python-pytest":
        for key, pattern in (("passed", r"(\d+) passed"), ("failed", r"(\d+) failed"),
                             ("errors", r"(\d+) error")):
            match = re.search(pattern, output)
            if match:
                counts[key] = int(match.group(1))
        counts["tests"] = counts.get("passed", 0) + counts.get("failed", 0) + counts.get("errors", 0)
    elif runner == "node-test":
        for key, pattern in (("tests", r"^# tests (\d+)"), ("passed", r"^# pass (\d+)"),
                             ("failed", r"^# fail (\d+)")):
            match = re.search(pattern, output, re.MULTILINE)
            if match:
                counts[key] = int(match.group(1))
    return counts


def _result(status, reason, **extra):
    sandboxed = bool(extra.pop("sandboxed", False))
    backend_name = str(extra.pop("backendName", "") or extra.get("backend") or "")
    base = {
        "version": VERSION,
        "status": status,
        "reason": reason,
        "sandboxed": sandboxed,
        "backend": extra.pop("backend", ""),
        "runner": extra.pop("runner", ""),
        "command": extra.pop("command", ""),
        "tests": extra.pop("tests", []),
        "counts": extra.pop("counts", {}),
        "files": extra.pop("files", 0),
        "skippedFiles": extra.pop("skippedFiles", 0),
        "exitCode": extra.pop("exitCode", None),
        "timedOut": extra.pop("timedOut", False),
        "outputTruncated": extra.pop("outputTruncated", False),
        "output": extra.pop("output", ""),
        "durationMs": extra.pop("durationMs", 0),
        "executedAt": extra.pop("executedAt", _now()),
        "limits": extra.pop("limits", {}),
        "isolation": {
            "network": "denied" if sandboxed else "not-run",
            "homeRead": "denied" if sandboxed else "not-run",
            "writes": "workspace-only" if sandboxed else "not-run",
            "environment": "minimal" if sandboxed else "not-run",
            "backend": backend_name if sandboxed else "",
        },
    }
    base.update(extra)
    return base


def run_task_tests(task, artifacts, command="", allowed_root=None,
                   timeout_seconds=None):
    """Run generated tests inside the selected sandbox.

    ``command`` is an optional user-supplied test command. It is parsed with
    shlex and restricted to an allowlist of test/runtime executables; it is
    still executed inside the sandbox with no network and no home reads.
    """
    started = time.time()
    be = backend()
    if not be or not available():
        return _result(
            "unavailable",
            ("当前平台没有受支持的沙箱后端（macOS sandbox-exec / Linux bubblewrap）；未执行测试"
             if not be else "bubblewrap 无法创建隔离命名空间；未执行测试（不会降级为无沙箱）"),
            sandboxed=False,
            backend="",
            durationMs=int((time.time() - started) * 1000),
            limits=capabilities()["limits"],
        )
    try:
        timeout = int(timeout_seconds or TIMEOUT_SECONDS)
    except (TypeError, ValueError):
        timeout = TIMEOUT_SECONDS
    timeout = max(1, min(MAX_TIMEOUT_SECONDS, timeout))
    workspace = Path(tempfile.mkdtemp(prefix="agent-office-testrun-")).resolve()
    try:
        materialized = _materialize(artifacts, workspace, allowed_root)
        (workspace / ".tmp").mkdir(exist_ok=True)
        requested = str(command or "").strip()
        argv, runner, tests, reason = _prepare_runner(workspace, requested)
        if not argv:
            return _result(
                "skipped", reason or "未发现可执行测试",
                sandboxed=True, backend=be, runner=runner, tests=tests,
                files=materialized["files"], skippedFiles=materialized["skipped"],
                durationMs=int((time.time() - started) * 1000),
                limits={
                    "timeoutSeconds": timeout, "maxOutputBytes": MAX_OUTPUT,
                    "maxFiles": MAX_FILES, "maxFileBytes": MAX_FILE_BYTES,
                    "maxTotalBytes": MAX_TOTAL_BYTES,
                },
            )
        runtime_roots = _runtime_roots([
            sys.executable, _which("node"), _which(Path(argv[0]).name),
        ])
        if be == "linux-bwrap" and _home_runtime_roots([
                sys.executable, _which("node"), _which(Path(argv[0]).name)]):
            return _result(
                "unavailable",
                "Linux bubblewrap 下运行时装在用户目录；为避免暴露 home，未执行测试",
                sandboxed=False, backend=be, runner=runner, command=_command_display(argv),
                tests=tests, files=materialized["files"],
                skippedFiles=materialized["skipped"],
                durationMs=int((time.time() - started) * 1000),
                limits={
                    "timeoutSeconds": timeout, "maxOutputBytes": MAX_OUTPUT,
                    "maxFiles": MAX_FILES, "maxFileBytes": MAX_FILE_BYTES,
                    "maxTotalBytes": MAX_TOTAL_BYTES,
                },
            )
        script = _runner_script(workspace, timeout)
        runtime_dirs = _runtime_dirs([sys.executable, _which("node"),
                                      _which(Path(argv[0]).name)])
        if be == "macos-seatbelt":
            env = _minimal_env(workspace, runtime_dirs)
            command_argv = [
                str(SANDBOX_EXEC), "-p", _profile(workspace, runtime_roots),
                "/bin/sh", str(script),
            ] + argv
        else:
            env = _minimal_env(Path("/workspace"), runtime_dirs)
            command_argv = _bwrap_command(workspace, script, argv, env)
        result = _run_bounded(command_argv, workspace, env, timeout)
        output = result["output"]
        if (be == "linux-bwrap" and result["exitCode"] not in (0, None) and
                re.search(r"(?im)^bwrap:.*(namespace|uid map|operation not permitted|permission denied)",
                          output)):
            return _result(
                "unavailable",
                "bubblewrap 无法创建隔离命名空间；未执行测试（不会降级为无沙箱）",
                sandboxed=False, backend=be, runner=runner,
                command=_command_display(argv), tests=tests,
                files=materialized["files"], skippedFiles=materialized["skipped"],
                output=output, exitCode=result["exitCode"],
                durationMs=int((time.time() - started) * 1000),
                limits={
                    "timeoutSeconds": timeout, "maxOutputBytes": MAX_OUTPUT,
                    "maxFiles": MAX_FILES, "maxFileBytes": MAX_FILE_BYTES,
                    "maxTotalBytes": MAX_TOTAL_BYTES,
                },
            )
        counts = _parse_counts(runner, output)
        zero_tests = (
            (runner == "python-unittest" and "Ran 0 tests" in output) or
            (runner == "python-pytest" and (
                "no tests ran" in output.lower() or result["exitCode"] == 5)) or
            (runner == "node-test" and counts.get("tests") == 0)
        )
        if result["timedOut"]:
            status = "failed"
            message = "测试超过 %ss，已终止整个进程组" % timeout
        elif zero_tests:
            status = "skipped"
            message = "测试运行器未发现可执行用例"
        elif result["exitCode"] == 0:
            status = "passed"
            passed = counts.get("tests")
            message = "测试通过" + ("（%s 项）" % passed if passed is not None else "")
        else:
            status = "failed"
            message = "测试失败，exit %s" % result["exitCode"]
        if result["truncated"]:
            message += "；输出超过上限，已截断"
        return _result(
            status, message + ((" · " + reason) if reason else ""),
            sandboxed=True, backend=be, backendName=be, runner=runner,
            command=_command_display(argv), tests=tests, counts=counts,
            files=materialized["files"], skippedFiles=materialized["skipped"],
            exitCode=result["exitCode"], timedOut=result["timedOut"],
            outputTruncated=result["truncated"], output=output,
            durationMs=int((time.time() - started) * 1000),
            limits={
                "timeoutSeconds": timeout, "maxOutputBytes": MAX_OUTPUT,
                "maxFiles": MAX_FILES, "maxFileBytes": MAX_FILE_BYTES,
                "maxTotalBytes": MAX_TOTAL_BYTES,
            },
        )
    except Exception as exc:
        return _result(
            "failed", "测试执行器内部错误：" + str(exc)[:300],
            sandboxed=True, backend=be,
            durationMs=int((time.time() - started) * 1000),
            limits=capabilities()["limits"],
        )
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
