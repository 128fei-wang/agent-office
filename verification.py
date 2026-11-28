#!/usr/bin/env python3
"""Deterministic evidence checks for generated task deliverables.

This module deliberately does not execute generated application code. It checks
that files exist, rejects placeholder output, parses structured formats, and
runs language syntax checks when the corresponding runtime is available. The
result is evidence, not a claim that the product works. A future execution
backend can extend this with sandboxed test commands.
"""
from __future__ import annotations

import datetime
import difflib
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import time
from html.parser import HTMLParser
from pathlib import Path

VERSION = "agent-office-verifier/1"
PLACEHOLDERS = {
    "已完成任务并提交交付物",
    "已完成任务并提交交付物。",
    "任务已完成",
    "done",
    "placeholder",
    "todo",
}
MAX_TEXT = 2 * 1024 * 1024


def _now():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _text_for(artifact):
    path = str(artifact.get("path") or "")
    if path:
        try:
            file_path = Path(path)
            if file_path.exists() and file_path.is_file():
                if file_path.stat().st_size > MAX_TEXT:
                    return "", "文件超过 2MB，跳过内容解析"
                return file_path.read_text("utf-8", errors="replace"), ""
        except OSError as exc:
            return "", "无法读取文件：" + str(exc)[:120]
    text = str(artifact.get("extractedText") or "")
    if text:
        return text, "文件缺失，使用已保存的文本证据"
    return "", "文件缺失或内容为空"


_JXA_WRAPPER = None


def _jxa_check(path, text=""):
    """macOS JavaScriptCore syntax check (no execution of the artifact)."""
    global _JXA_WRAPPER
    tool = shutil.which("osascript")
    if not tool:
        return None
    if not _JXA_WRAPPER:
        handle = tempfile.NamedTemporaryFile(
            "w", suffix=".js", prefix="agent-office-jscheck-", delete=False, encoding="utf-8")
        handle.write(
            "ObjC.import('Foundation');\n"
            "function run(argv) {\n"
            "  var text = $.NSString.stringWithContentsOfFileEncodingError($(argv[0]), $.NSUTF8StringEncoding, null);\n"
            "  if (!text) return 'ERR read';\n"
            "  try { new Function(ObjC.unwrap(text)); return 'OK'; } catch (e) { return 'ERR ' + e; }\n"
            "}\n")
        handle.close()
        _JXA_WRAPPER = handle.name
    try:
        result = subprocess.run([tool, "-l", "JavaScript", _JXA_WRAPPER, str(path)],
                                capture_output=True, text=True, timeout=15)
        output = (result.stdout or result.stderr or "").strip()
        if result.returncode == 0 and output.startswith("OK"):
            return "passed", "JavaScript 语法通过（JavaScriptCore）", "syntax"
        if output.startswith("ERR"):
            if re.search(r"<[A-Za-z][A-Za-z0-9]*(?:\s|/|>)", text) or "React.createElement" in text:
                return "skipped", "疑似 JSX，需构建工具才能验证", "runtime"
            return "failed", output[3:].strip()[:240], "syntax"
    except (OSError, subprocess.SubprocessError):
        return None
    return None


def _sha256(path):
    try:
        digest = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return ""


def _syntax_check(name, text, path=""):
    suffix = Path(name).suffix.lower()
    if suffix == ".json":
        try:
            json.loads(text)
            return "passed", "JSON 解析通过", "syntax"
        except Exception as exc:
            return "failed", "JSON 解析失败：" + str(exc)[:160], "syntax"
    if suffix == ".py":
        try:
            compile(text, name or "artifact.py", "exec")
            return "passed", "Python 语法通过", "syntax"
        except SyntaxError as exc:
            return "failed", "Python 语法错误：第 %s 行 %s" % (exc.lineno, exc.msg), "syntax"
        except Exception as exc:
            return "failed", "Python 解析失败：" + str(exc)[:160], "syntax"
    if suffix in (".js", ".mjs", ".cjs"):
        node = shutil.which("node")
        if node:
            try:
                result = subprocess.run([node, "--check", str(path or name)], capture_output=True,
                                        text=True, timeout=15)
                if result.returncode == 0:
                    return "passed", "JavaScript 语法通过", "syntax"
                if re.search(r"<[A-Za-z][A-Za-z0-9]*(?:\s|/|>)", text) or "React.createElement" in text:
                    return "skipped", "疑似 JSX，需构建工具才能验证", "runtime"
                return "failed", (result.stderr or result.stdout or "node --check failed")[:240], "syntax"
            except (OSError, subprocess.SubprocessError) as exc:
                return "skipped", "Node 检查未完成：" + str(exc)[:120], "runtime"
        jxa = _jxa_check(path, text)
        if jxa:
            return jxa
        return "skipped", "未找到 Node/JavaScriptCore，JavaScript 语法未检查", "runtime"
    if suffix == ".sh":
        bash = shutil.which("bash")
        if not bash:
            return "skipped", "未安装 bash，Shell 语法未检查", "runtime"
        try:
            result = subprocess.run([bash, "-n", str(path or name)], capture_output=True,
                                    text=True, timeout=15)
            if result.returncode == 0:
                return "passed", "Shell 语法通过", "syntax"
            return "failed", (result.stderr or result.stdout or "bash -n failed")[:240], "syntax"
        except (OSError, subprocess.SubprocessError) as exc:
            return "skipped", "Shell 检查未完成：" + str(exc)[:120], "runtime"
    if suffix in (".html", ".htm"):
        if "<html" not in text.lower() or "</html>" not in text.lower():
            return "failed", "HTML 缺少 html 根标签", "syntax"
        try:
            HTMLParser().feed(text)
            return "passed", "HTML 结构解析通过", "syntax"
        except Exception as exc:
            return "failed", "HTML 解析失败：" + str(exc)[:160], "syntax"
    if suffix == ".css":
        if text.count("{") != text.count("}"):
            return "failed", "CSS 花括号不配对", "syntax"
        return "passed", "CSS 结构检查通过", "syntax"
    if suffix in (".md", ".txt"):
        normalized = re.sub(r"\s+", "", text).strip("。.!！ ")
        if normalized.lower() in PLACEHOLDERS:
            return "failed", "交付物是占位内容", "content"
        if len(normalized) < 12:
            return "failed", "交付物内容过短，无法作为证据", "content"
        return "skipped", "文档内容已保存；未执行运行验证", "presence"
    if suffix in (".docx", ".doc", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".zip"):
        return "skipped", "二进制文件已保存；未执行内容解析", "presence"
    return "skipped", "未识别的文件类型；仅校验存在性", "presence"


def _artifact_text(artifact):
    path = str(artifact.get("path") or "")
    if path:
        try:
            file_path = Path(path)
            if file_path.is_file() and file_path.stat().st_size <= MAX_TEXT:
                return file_path.read_text("utf-8", errors="replace")
        except OSError:
            pass
    return str(artifact.get("extractedText") or "")


def artifact_diff(previous, current):
    """Line-level evidence for unchanged, added, removed and modified files."""
    old_rows = [a for a in (previous or []) if isinstance(a, dict)]
    new_rows = [a for a in (current or []) if isinstance(a, dict)]
    old_by = {str(a.get("name") or a.get("id") or "file"): a for a in old_rows}
    new_by = {str(a.get("name") or a.get("id") or "file"): a for a in new_rows}
    names = list(new_by.keys()) + [name for name in old_by if name not in new_by]
    files = []
    total_added = 0
    total_removed = 0
    for name in names[:40]:
        old = _artifact_text(old_by[name]) if name in old_by else ""
        new = _artifact_text(new_by[name]) if name in new_by else ""
        old_lines = old.splitlines()
        new_lines = new.splitlines()
        if name not in old_by:
            status = "added"
            added = len(new_lines)
            removed = 0
            preview = "\n".join("+ " + line for line in new_lines[:80])
        elif name not in new_by:
            status = "removed"
            added = 0
            removed = len(old_lines)
            preview = "\n".join("- " + line for line in old_lines[:80])
        elif old == new:
            continue
        else:
            status = "modified"
            diff_lines = list(difflib.unified_diff(
                old_lines, new_lines, fromfile="previous/" + name, tofile="current/" + name,
                lineterm="", n=2))
            added = sum(1 for line in diff_lines if line.startswith("+") and not line.startswith("+++"))
            removed = sum(1 for line in diff_lines if line.startswith("-") and not line.startswith("---"))
            preview = "\n".join(diff_lines[:140])
        total_added += added
        total_removed += removed
        files.append({
            "name": name,
            "status": status,
            "added": added,
            "removed": removed,
            "preview": preview[:8000],
        })
    return {
        "files": files,
        "added": total_added,
        "removed": total_removed,
        "changed": len(files),
        "previousFiles": len(old_rows),
        "currentFiles": len(new_rows),
        "generatedAt": _now(),
    }


def verify_task(task, artifacts):
    """Return a JSON-safe verification report for a task's artifacts."""
    started = time.time()
    artifacts = [a for a in (artifacts or []) if isinstance(a, dict)]
    checks = []
    files = []
    if not artifacts:
        return {
            "version": VERSION,
            "status": "failed",
            "level": "none",
            "reason": "任务没有可验证的交付文件",
            "files": 0,
            "passed": 0,
            "failed": 1,
            "skipped": 0,
            "hasTests": False,
            "checks": [],
            "verifiedAt": _now(),
            "durationMs": int((time.time() - started) * 1000),
        }

    for artifact in artifacts:
        name = str(artifact.get("name") or artifact.get("id") or "deliverable")
        size = int(artifact.get("size") or 0)
        path = str(artifact.get("path") or "")
        text, text_error = _text_for(artifact)
        file_row = {
            "name": name,
            "size": size,
            "sha256": _sha256(path) if path else "",
            "kind": Path(name).suffix.lower().lstrip(".") or "file",
        }
        files.append(file_row)
        present = bool(path and Path(path).is_file() and Path(path).stat().st_size > 0)
        if not present:
            checks.append({
                "name": name,
                "kind": "presence",
                "status": "failed",
                "detail": text_error or "文件缺失",
            })
            continue
        checks.append({
            "name": name,
            "kind": "presence",
            "status": "passed",
            "detail": "文件存在 · " + str(size) + " B",
        })
        if not text:
            checks.append({
                "name": name,
                "kind": "content",
                "status": "failed",
                "detail": text_error or "文件内容为空",
            })
            continue
        normalized = re.sub(r"\s+", "", text).strip("。.!！ ")
        if normalized.lower() in PLACEHOLDERS:
            checks.append({
                "name": name,
                "kind": "content",
                "status": "failed",
                "detail": "检测到占位交付内容",
            })
            continue
        status, detail, kind = _syntax_check(name, text, path)
        checks.append({"name": name, "kind": kind, "status": status, "detail": detail})

    failed = sum(1 for check in checks if check["status"] == "failed")
    passed = sum(1 for check in checks if check["status"] == "passed")
    skipped = sum(1 for check in checks if check["status"] == "skipped")
    syntax_passed = sum(1 for check in checks
                        if check["status"] == "passed" and check["kind"] == "syntax")
    runtime_skipped = any(check["status"] == "skipped" and check["kind"] == "runtime"
                          for check in checks)
    has_tests = any(re.search(r"(^|/)(test|spec)[^/]*\.(js|py|sh|ts)$|\.test\.(js|ts)$|(^|/)test_[^/]+\.py$",
                              file_row["name"], re.I) for file_row in files)
    if failed:
        status = "failed"
        level = "syntax" if syntax_passed else "presence"
        reason = "有 %s 项检查失败" % failed
    elif syntax_passed:
        status = "passed"
        level = "syntax"
        reason = "语法检查通过；未执行项目测试"
    elif runtime_skipped:
        status = "unverified"
        level = "runtime"
        reason = "文件存在，但运行环境缺失，未执行代码检查"
    else:
        status = "unverified"
        level = "presence"
        reason = "文件存在；文档类交付未执行运行验证"
    if has_tests and status != "failed":
        reason += "；检测到测试文件，但当前未执行"
    return {
        "version": VERSION,
        "status": status,
        "level": level,
        "reason": reason,
        "files": len(files),
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "hasTests": has_tests,
        "checks": checks[:80],
        "fileEvidence": files[:80],
        "verifiedAt": _now(),
        "durationMs": int((time.time() - started) * 1000),
    }
