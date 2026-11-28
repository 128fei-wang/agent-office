#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
eval_phase1.py — Agent Office Phase 1「真实执行 MVP」黑盒验收评测。

用法（在仓库根目录运行）:
    python3 scripts/eval_phase1.py --json /tmp/eval-phase1.json
    python3 scripts/eval_phase1.py --case g1_exit0_done
    python3 scripts/eval_phase1.py --list

退出码:
    0  全过，或「仅有 SKIP、无失败」
    1  存在任一 fail
    2  用法/参数错误

设计约束（见 docs/RUNNER_DESIGN.md 与交付任务）:
    - 只用标准库；无网络（不 push/fetch，不访问远端）；无交互。
    - 全部状态写入 tempfile.mkdtemp()，经 BRIDGE_STATE_DIR / BRIDGE_STATE /
      BRIDGE_PROVIDERS 指向临时目录；不读写真实 ~/.agent-office。
    - 每个用例独立空闲端口（bind 0）、独立临时 git 仓库（git init + 少量本地提交）。
    - 结束 kill 进程组并清理临时目录；不杀非本评测进程。
    - 评测前后当前仓库 git status 必须一致。
    - 单用例超时 ≤ 60s，总超时 ≤ 10min；超时判 fail 并留日志。
    - 反作弊: 只经 HTTP / CLI / 落盘产物（git diff、DB、evidence bundle、日志）断言，
      不 import runner / bridge 内部函数伪造结果。

CONTRACT（评测假设的实现界面，实现时必须对齐）:
    bridge  env   BRIDGE_STATE_DIR / BRIDGE_STATE / BRIDGE_PROVIDERS
    bridge  cli   python3 bridge.py --host 127.0.0.1 --port <N>
    bridge  http  GET /health → 200；POST /mcp（Streamable HTTP MCP）
    runner  cli   python3 runner.py --task-id <T> --worktree <dir> --base-commit <H>
                  [--test-command <cmd>] [--agent-cmd <cmd>]
    runner  env   AGENT_OFFICE_RUN_TOKEN（只注入该 Agent 进程）、BRIDGE_STATE_DIR
    mcp submit    POST /mcp, tool = agent_office_submit_evidence,
                  args {runId, claim{...}}, header AGENT_OFFICE_RUN_TOKEN
    落盘   SQLite BRIDGE_STATE_DIR/agent-office.db（表 runs / run_evidence / events …）
    落盘   evidence bundle: GET /missions/<id>/evidence/bundle

已知前提: Phase 1「真实执行 MVP」已落地 runner + submit_evidence MCP + SQLite 迁移。
依赖审批/merge、事件流（SSE）、跨任务编排的用例超出本阶段范围，显式标注 SKIP（附原因），不判失败。
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BRIDGE_PY = REPO_ROOT / "bridge.py"
RUNNER_PY = REPO_ROOT / "runner.py"
MIGRATION_PY = REPO_ROOT / "migration.py"

PY = sys.executable or "python3"

PER_CASE_TIMEOUT = 60.0
TOTAL_TIMEOUT = 600.0


# --------------------------------------------------------------------------- #
# 工具
# --------------------------------------------------------------------------- #

def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def http_request(method: str, port: int, path: str,
                 body: bytes | None = None,
                 headers: dict | None = None,
                 timeout: float = 5.0):
    url = f"http://127.0.0.1:{port}{path}"
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except Exception as e:  # noqa: BLE001 — 黑盒，网络错误如实返回
        return None, {}, (f"{type(e).__name__}: {e}").encode()


def wait_http(port: int, path: str = "/health", timeout: float = 15.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        status, _, _ = http_request("GET", port, path, timeout=1.0)
        if status == 200:
            return True
        time.sleep(0.1)
    return False


def run_cmd(args, cwd, env=None, timeout=30.0):
    """运行一条命令，返回 (returncode, stdout, stderr)。超时抛 TimeoutError。"""
    merged = dict(os.environ)
    merged.pop("BRIDGE_STATE_DIR", None)
    merged.pop("BRIDGE_STATE", None)
    merged.pop("BRIDGE_PROVIDERS", None)
    if env:
        merged.update(env)
    return subprocess.run(
        args, cwd=str(cwd), env=merged, capture_output=True, text=True,
        timeout=timeout, start_new_session=True)


def make_git_repo(path: Path) -> str:
    """在 path 建一个独立本地仓库，返回首个 commit hash。不配 remote、不 push。"""
    path.mkdir(parents=True, exist_ok=True)
    (path / "README.md").write_text("# eval repo\n", encoding="utf-8")
    git = ["git", "-C", str(path)]
    subprocess.run(git + ["init", "-q"], check=True, capture_output=True)
    subprocess.run(git + ["config", "user.name", "eval"], check=True, capture_output=True)
    subprocess.run(git + ["config", "user.email", "eval@example.test"], check=True, capture_output=True)
    subprocess.run(git + ["add", "-A"], check=True, capture_output=True)
    subprocess.run(git + ["commit", "-q", "-m", "base"], check=True, capture_output=True)
    return subprocess.run(git + ["rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()


def git_porcelain(path: Path) -> str:
    r = subprocess.run(["git", "-C", str(path), "status", "--porcelain"],
                       capture_output=True, text=True)
    return r.stdout


def git_diff(path: Path, base: str) -> str:
    r = subprocess.run(["git", "-C", str(path), "diff", base],
                       capture_output=True, text=True)
    return r.stdout


def kill_group(proc):
    if proc is None or proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except OSError:
            pass


def git_status_snapshot() -> str:
    r = subprocess.run(["git", "-C", str(REPO_ROOT), "status", "--porcelain=v1"],
                       capture_output=True, text=True)
    h = subprocess.run(["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
                       capture_output=True, text=True)
    return r.stdout + "@HEAD=" + h.stdout.strip()


# --------------------------------------------------------------------------- #
# 黑盒辅助：runner CLI / MCP / 落盘 SQLite（不 import 内部函数伪造结果）
# --------------------------------------------------------------------------- #

def run_runner(ctx: "Ctx", task_id: str, worktree, base_commit, **flags):
    """调用 runner.py CLI，返回 (CompletedProcess, 解析后的 stdout JSON dict)。"""
    args = [PY, str(RUNNER_PY), "--task-id", task_id,
            "--worktree", str(worktree), "--base-commit", str(base_commit)]
    for key, value in flags.items():
        flag = "--" + key.replace("_", "-")
        if value is True:
            args.append(flag)
        elif value not in (None, "", False):
            args += [flag, str(value)]
    r = run_cmd(args, ctx.tmp, ctx.bridge_env())
    result = {}
    try:
        result = json.loads(r.stdout)
    except Exception:  # noqa: BLE001
        result = {"_raw_stdout": r.stdout, "_raw_stderr": r.stderr}
    return r, result


def get_run_row(ctx: "Ctx", run_id: str):
    conn = ctx.db()
    try:
        row = conn.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def mcp_tool_call(port: int, name: str, arguments: dict,
                  run_token: str | None = None, agent_id: str = "eval-agent"):
    """POST /mcp tools/call；返回 (status, 解析后的 result 文本 dict)。"""
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": name, "arguments": arguments}}
    headers = {"Content-Type": "application/json"}
    if agent_id:
        headers["X-Agent-Id"] = agent_id
    if run_token:
        headers["AGENT_OFFICE_RUN_TOKEN"] = run_token
    status, _, raw = http_request("POST", port, "/mcp",
                                  body=json.dumps(payload).encode(),
                                  headers=headers)
    if not raw:
        return status, None
    try:
        resp = json.loads(raw)
    except Exception:  # noqa: BLE001
        return status, None
    result = resp.get("result") if isinstance(resp, dict) else None
    if isinstance(result, dict) and isinstance(result.get("content"), list):
        try:
            text = result["content"][0].get("text", "")
            return status, json.loads(text)
        except Exception:  # noqa: BLE001
            return status, result
    return status, result


BROWSER_ORIGIN = "http://127.0.0.1:5173"  # a port in the bridge's allowlist


def browser_post(port: int, path: str, body: dict | None = None):
    """POST as a trusted browser (Origin header). Returns (status, parsed JSON)."""
    status, _, raw = http_request(
        "POST", port, path, body=json.dumps(body or {}).encode(),
        headers={"Content-Type": "application/json", "Origin": BROWSER_ORIGIN})
    try:
        return status, (json.loads(raw) if raw else None)
    except Exception:  # noqa: BLE001
        return status, None


def run_agent_writes(ctx: "Ctx", task_id: str, filename: str = "x.txt",
                     content: str = "hi", **flags):
    """Run a runner whose agent writes one file (produces a diff)."""
    agent_cmd = f"{PY} -c \"open('{ctx.repo}/{filename}','w').write('{content}')\""
    return run_runner(ctx, task_id, ctx.repo, ctx.base_commit,
                      agent_cmd=agent_cmd, **flags)


def make_run_with_token(ctx: "Ctx", task_id: str = "eval-g4",
                        token: str = "eval-token", agent_id: str = "eval-agent"):
    """用一个真实 runner run 建 schema + run，然后把 token 换成已知明文。

    返回 (run_id, token)。这只经 CLI + 原生 sqlite3，不 import 内部函数。
    """
    agent_cmd = f"{PY} -c \"open('{ctx.repo}/x.txt','w').write('hi')\""
    _, res = run_runner(ctx, task_id, ctx.repo, ctx.base_commit,
                        agent_cmd=agent_cmd, agent_id=agent_id)
    run_id = res.get("runId")
    if not run_id:
        return None, token
    conn = ctx.db()
    try:
        conn.execute("UPDATE run_tokens SET token_hash=?, agent_id=? WHERE run_id=?",
                     (hashlib.sha256(token.encode()).hexdigest(), agent_id, run_id))
        conn.commit()
    finally:
        conn.close()
    return run_id, token


def db_checksum(ctx: "Ctx"):
    """对迁移后的 SQLite 各表做确定性校验和（行数 + 规范化内容 hash）。"""
    conn = ctx.db()
    try:
        tables = ("missions", "tasks", "conversations", "messages",
                  "approvals", "artifacts", "memories", "model_calls")
        parts = {}
        for t in tables:
            rows = conn.execute(
                f"SELECT data FROM {t} ORDER BY id").fetchall()
            parts[t] = {"n": len(rows), "hash": hashlib.sha256(
                "\n".join(r[0] for r in rows).encode("utf-8")).hexdigest()}
        return parts
    finally:
        conn.close()


def make_sample_missions_json(ctx: "Ctx", n_missions: int = 60) -> Path:
    """生成一个真实结构的 missions.json 样本，返回其路径。"""
    data = {
        "version": 1,
        "missions": [], "conversations": [], "messages": [], "approvals": [],
        "artifacts": [], "memories": [], "modelCalls": [],
        "next": {"message": 1},
    }
    for i in range(n_missions):
        mid = f"msn-{i:04d}"
        tasks = []
        for j in range(3):
            tasks.append({
                "id": f"tsk-{i:04d}-{j}", "key": f"T{i}-{j}",
                "title": f"task {i}.{j}", "status": "todo",
                "assigneeId": f"agent-{j}", "assigneeName": f"Agent {j}",
                "priority": "P1", "noTests": 0,
                "createdAt": "2026-11-28T00:00:00Z", "updatedAt": "2026-11-28T00:00:00Z",
                "expectedPaths": [f"src/t{i}-{j}"], "pinnedTests": [],
                "deliverableTests": [], "testCommand": "python3 -m unittest",
            })
        data["missions"].append({
            "id": mid, "title": f"mission {i}", "status": "active",
            "priority": "P1", "deadline": "2026-12-31",
            "createdAt": "2026-11-28T00:00:00Z", "updatedAt": "2026-11-28T00:00:00Z",
            "tasks": tasks,
        })
        data["conversations"].append({
            "id": f"conv-{i:04d}", "missionId": mid, "title": f"# {i}",
            "createdAt": "2026-11-28T00:00:00Z", "updatedAt": "2026-11-28T00:00:00Z"})
        data["messages"].append({
            "id": f"msg-{i:04d}", "conversationId": f"conv-{i:04d}",
            "createdAt": "2026-11-28T00:00:00Z", "text": "hi"})
        data["approvals"].append({
            "id": f"app-{i:04d}", "missionId": mid, "taskId": f"tsk-{i:04d}-0",
            "status": "pending"})
        data["artifacts"].append({
            "id": f"art-{i:04d}", "missionId": mid, "name": f"a{i}"})
    data["memories"].append({"id": "mem-0001", "text": "sample"})
    data["modelCalls"].append({"id": "mc-0001", "provider": "eval"})
    path = ctx.tmp / "missions.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
    return path


# --------------------------------------------------------------------------- #
# 能力探测（决定 SKIP 而非误报 fail）
# --------------------------------------------------------------------------- #

def has_bridge() -> bool:
    return BRIDGE_PY.exists()


def has_runner() -> bool:
    return RUNNER_PY.exists() and RUNNER_PY.stat().st_size > 0


def has_submit_evidence() -> bool:
    if not BRIDGE_PY.exists():
        return False
    src = BRIDGE_PY.read_text(encoding="utf-8", errors="ignore")
    return "submit_evidence" in src


def has_migration() -> bool:
    return MIGRATION_PY.exists() and MIGRATION_PY.stat().st_size > 0


# --------------------------------------------------------------------------- #
# 结果与上下文
# --------------------------------------------------------------------------- #

class Result:
    def __init__(self, status: str, expected: str, actual: str,
                 evidence: str = "", repro: str = ""):
        self.status = status          # pass / fail / skip
        self.expected = expected
        self.actual = actual
        self.evidence = evidence      # 证据路径或说明
        self.repro = repro            # 复现命令

    @staticmethod
    def skip(reason: str, expected: str = ""):
        return Result("skip", expected or "（前置未满足，显式跳过）", reason)

    @staticmethod
    def fail(expected: str, actual: str, repro: str = "", evidence: str = ""):
        return Result("fail", expected, actual, evidence=evidence, repro=repro)

    @staticmethod
    def ok(expected: str, actual: str = "", evidence: str = ""):
        return Result("pass", expected, actual or "符合预期", evidence=evidence)


class Ctx:
    """一个用例的隔离上下文。"""

    def __init__(self, case_id: str):
        self.case_id = case_id
        self.tmp = Path(tempfile.mkdtemp(prefix=f"eval-{case_id}-"))
        self.state_dir = self.tmp / "state"
        self.state_dir.mkdir(mode=0o700)
        self.repo = self.tmp / "repo"
        self.base_commit = make_git_repo(self.repo)
        self.port = free_port()
        self.bridge = None
        self.procs = []          # 需要一并回收的子进程
        self.evidence_dir = self.tmp / "evidence"
        self.evidence_dir.mkdir()

    def bridge_env(self) -> dict:
        return {
            "BRIDGE_STATE_DIR": str(self.state_dir),
            "BRIDGE_STATE": str(self.state_dir / "bridge-state.json"),
            "BRIDGE_PROVIDERS": str(self.state_dir / "providers.json"),
        }

    def start_bridge(self):
        if self.bridge is not None:
            return
        self.bridge = subprocess.Popen(
            [PY, str(BRIDGE_PY), "--host", "127.0.0.1", "--port", str(self.port)],
            env={**os.environ, **self.bridge_env()},
            stdout=open(self.tmp / "bridge.log", "wb"),
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        self.procs.append(self.bridge)

    def spawn(self, args, env=None):
        p = subprocess.Popen(
            args, cwd=str(self.tmp), env={**os.environ, **self.bridge_env(), **(env or {})},
            stdout=open(self.tmp / f"{self.case_id}.out", "wb"),
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        self.procs.append(p)
        return p

    def db(self) -> sqlite3.Connection:
        db_path = self.state_dir / "agent-office.db"
        if not db_path.exists():
            raise FileNotFoundError(f"SQLite 未落盘: {db_path}")
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def cleanup(self):
        for p in reversed(self.procs):
            kill_group(p)
        shutil.rmtree(self.tmp, ignore_errors=True)


# --------------------------------------------------------------------------- #
# 用例定义（覆盖矩阵：映射 RUNNER_DESIGN 条款，每条正向 + 反向）
# --------------------------------------------------------------------------- #

def c_g1_exit0_done(ctx: Ctx) -> Result:
    """G1 正向：进程退出码 0 + 有 diff → 进入待批准（成功路径，不自动 done）。"""
    if not has_runner():
        return Result.skip("runner 实现未落地（三处验收变更待老板签字）")
    agent_cmd = f"{PY} -c \"open('{ctx.repo}/x.txt','w').write('hi')\""
    _, res = run_runner(ctx, "eval-g1", ctx.repo, ctx.base_commit, agent_cmd=agent_cmd)
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    if row and row["status"] == "waiting_approval" and not row["fail_reason"]:
        return Result.ok("exit 0 且产生 diff 的 run 应进入 waiting_approval（待批准+merge，不自动 done）",
                         f"status={row['status']} fail_reason={row['fail_reason']!r}",
                         evidence=str(ctx.state_dir / "agent-office.db"))
    return Result.fail("exit 0 且产生 diff 的 run 应进入 waiting_approval",
                       f"status={(row or {}).get('status')!r} fail_reason={(row or {}).get('fail_reason')!r} raw={res}",
                       repro="python3 scripts/eval_phase1.py --case g1_exit0_done")


def c_g1_nonzero_fail(ctx: Ctx) -> Result:
    """G1 反向：退出码非 0 → 不得 done。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    agent_cmd = f"{PY} -c \"import sys; sys.exit(3)\""
    _, res = run_runner(ctx, "eval-g1-nz", ctx.repo, ctx.base_commit, agent_cmd=agent_cmd)
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    if row and row["status"] == "failed" and row["fail_reason"] == "non_zero_exit":
        return Result.ok("退出码非 0 的 run 应置 failed(non_zero_exit)",
                         f"status={row['status']} fail_reason={row['fail_reason']}")
    return Result.fail("退出码非 0 的 run 应置 failed(non_zero_exit)",
                       f"status={(row or {}).get('status')!r} fail_reason={(row or {}).get('fail_reason')!r}",
                       repro="python3 scripts/eval_phase1.py --case g1_nonzero_fail")


def c_g1_timeout_fail(ctx: Ctx) -> Result:
    """G1 反向：超时 → 不得 done。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    agent_cmd = f"{PY} -c \"import time; time.sleep(30)\""
    _, res = run_runner(ctx, "eval-g1-to", ctx.repo, ctx.base_commit,
                        agent_cmd=agent_cmd, timeout=1)
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    if row and row["status"] == "failed" and row["fail_reason"] == "timeout":
        return Result.ok("超时的 run 应置 failed(timeout)",
                         f"status={row['status']} fail_reason={row['fail_reason']}")
    return Result.fail("超时的 run 应置 failed(timeout)",
                       f"status={(row or {}).get('status')!r} fail_reason={(row or {}).get('fail_reason')!r}",
                       repro="python3 scripts/eval_phase1.py --case g1_timeout_fail")


def c_g1_sigkill_fail(ctx: Ctx) -> Result:
    """G1 反向：被 SIGKILL → 不得 done。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    _, res = run_runner(ctx, "eval-g1-kill", ctx.repo, ctx.base_commit, agent_cmd="kill -9 $$")
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    if row and row["status"] == "failed" and row["fail_reason"] == "killed":
        return Result.ok("被 SIGKILL 的 run 应置 failed(killed)",
                         f"status={row['status']} fail_reason={row['fail_reason']}")
    return Result.fail("被 SIGKILL 的 run 应置 failed(killed)",
                       f"status={(row or {}).get('status')!r} fail_reason={(row or {}).get('fail_reason')!r}",
                       repro="python3 scripts/eval_phase1.py --case g1_sigkill_fail")


def c_g2_diff_pass(ctx: Ctx) -> Result:
    """G2 正向：有 diff → 通过。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    agent_cmd = f"{PY} -c \"open('{ctx.repo}/feature.txt','w').write('v2')\""
    _, res = run_runner(ctx, "eval-g2", ctx.repo, ctx.base_commit, agent_cmd=agent_cmd)
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    if not res.get("has_diff"):
        return Result.fail("有改动的 run 应 has_diff=true", json.dumps(res, ensure_ascii=False),
                           repro="python3 scripts/eval_phase1.py --case g2_diff_pass")
    if row and row["status"] == "waiting_approval":
        return Result.ok("有 diff 的 run 应通过 G2 进入待批准",
                         f"has_diff={res.get('has_diff')} status={row['status']}")
    return Result.fail("有 diff 的 run 应通过 G2（waiting_approval）",
                       f"status={(row or {}).get('status')!r}",
                       repro="python3 scripts/eval_phase1.py --case g2_diff_pass")


def c_g2_empty_diff_blocked(ctx: Ctx) -> Result:
    """G2 反向：空 diff 且无「无改动论证」→ blocked（failed/empty_run）。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    _, res = run_runner(ctx, "eval-g2-empty", ctx.repo, ctx.base_commit, agent_cmd="true")
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    if row and row["status"] == "failed" and row["fail_reason"] == "empty_run":
        return Result.ok("空 diff 且无 noChange claim 的 run 应置 failed(empty_run)",
                         f"status={row['status']} fail_reason={row['fail_reason']}")
    return Result.fail("空 diff 且无 claim 的 run 应置 failed(empty_run)",
                       f"status={(row or {}).get('status')!r} fail_reason={(row or {}).get('fail_reason')!r}",
                       repro="python3 scripts/eval_phase1.py --case g2_empty_diff_blocked")


def c_g2_empty_diff_claim_review(ctx: Ctx) -> Result:
    """G2 正向：空 diff + claim → 走人审，不自动 done。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    _, res = run_runner(ctx, "eval-g2-claim", ctx.repo, ctx.base_commit,
                        agent_cmd="true", claim='{"noChange": true, "reason": "docs only"}')
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    if row and row["status"] == "waiting_approval" and row["review_reason"] == "no_change_claim":
        return Result.ok("空 diff + noChange claim 应走人审，不自动 done",
                         f"status={row['status']} review_reason={row['review_reason']}")
    return Result.fail("空 diff + noChange claim 应置 waiting_approval(no_change_claim)",
                       f"status={(row or {}).get('status')!r} review_reason={(row or {}).get('review_reason')!r}",
                       repro="python3 scripts/eval_phase1.py --case g2_empty_diff_claim_review")


def c_g2_untracked_in_diff(ctx: Ctx) -> Result:
    """G2 反向：untracked 新文件必须进 diffHash（只 add 部分，验证未跟踪也采集）。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    (ctx.repo / "new_untracked.txt").write_text("untracked", encoding="utf-8")
    (ctx.repo / "tracked.txt").write_text("tracked", encoding="utf-8")
    run_cmd(["git", "-C", str(ctx.repo), "add", "tracked.txt"], ctx.tmp)
    # 只 add 了 tracked.txt，new_untracked.txt 仍未跟踪；采集须同时覆盖两者
    _, res = run_runner(ctx, "eval-g2-untracked", ctx.repo, ctx.base_commit, agent_cmd="true")
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    conn = ctx.db()
    try:
        diff_row = conn.execute(
            "SELECT content FROM run_evidence WHERE run_id=? AND kind='diff' LIMIT 1",
            (run_id,)).fetchone()
    finally:
        conn.close()
    diff_text = diff_row["content"] if diff_row else ""
    if res.get("has_diff") and "new_untracked.txt" in diff_text:
        return Result.ok("untracked 新文件应进 diff（含内容）",
                         f"has_diff={res.get('has_diff')} diff_mentions_untracked=True",
                         evidence=str(ctx.state_dir / "agent-office.db"))
    return Result.fail("untracked 新文件应进 diffHash/evidence",
                       f"has_diff={res.get('has_diff')} diff={diff_text[:200]!r}",
                       repro="python3 scripts/eval_phase1.py --case g2_untracked_in_diff")


def c_g3_test_pass(ctx: Ctx) -> Result:
    """G3 正向：测试通过 → 待批准。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    (ctx.repo / "test_eval.py").write_text(
        "import unittest\nclass T(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n",
        encoding="utf-8")
    _, res = run_runner(ctx, "eval-g3p", ctx.repo, ctx.base_commit,
                        agent_cmd="true", test_command="python3 -m unittest test_eval")
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    if row and row["status"] == "waiting_approval" and res.get("test_passed"):
        return Result.ok("任务声明的测试通过应进入待批准",
                         f"status={row['status']} test_passed={res.get('test_passed')} "
                         f"n_passed={res.get('test_n_passed')} n_failed={res.get('test_n_failed')}")
    return Result.fail("任务声明的测试通过应进入待批准（不 test_failed）",
                       f"status={(row or {}).get('status')!r} test_passed={res.get('test_passed')} "
                       f"n_passed={res.get('test_n_passed')} n_failed={res.get('test_n_failed')}",
                       repro="python3 scripts/eval_phase1.py --case g3_test_pass")


def c_g3_test_fail(ctx: Ctx) -> Result:
    """G3 反向：测试失败 → 不得 done。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    (ctx.repo / "test_eval.py").write_text(
        "import unittest\nclass T(unittest.TestCase):\n    def test_bad(self):\n        self.assertTrue(False)\n",
        encoding="utf-8")
    _, res = run_runner(ctx, "eval-g3f", ctx.repo, ctx.base_commit,
                        agent_cmd="true", test_command="python3 -m unittest test_eval")
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    if row and row["status"] == "failed" and row["fail_reason"] == "test_failed":
        return Result.ok("测试失败应置 failed(test_failed)，不得 done",
                         f"status={row['status']} fail_reason={row['fail_reason']}")
    return Result.fail("测试失败应置 failed(test_failed)",
                       f"status={(row or {}).get('status')!r} fail_reason={(row or {}).get('fail_reason')!r} "
                       f"test_passed={res.get('test_passed')}",
                       repro="python3 scripts/eval_phase1.py --case g3_test_fail")


def c_g3_no_tests_doc(ctx: Ctx) -> Result:
    """G3 规则：文档类任务（no_tests）不得静默 done。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    agent_cmd = f"{PY} -c \"open('{ctx.repo}/docs.md','w').write('# doc')\""
    _, res = run_runner(ctx, "eval-g3-doc", ctx.repo, ctx.base_commit,
                        agent_cmd=agent_cmd, no_tests=True)
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    if row and row["status"] == "waiting_approval" and row["test_output_hash"] is None:
        return Result.ok("no_tests 的文档任务应走 diff + 人审，不静默 done 也不跑测试",
                         f"status={row['status']} test_output_hash={row['test_output_hash']!r}")
    return Result.fail("no_tests 的文档任务应走 waiting_approval 且不产生 test_output",
                       f"status={(row or {}).get('status')!r} test_output_hash={(row or {}).get('test_output_hash')!r}",
                       repro="python3 scripts/eval_phase1.py --case g3_no_tests_doc")


def c_g3_custom_cmd_not_allowlist(ctx: Ctx) -> Result:
    """G3 反向：自定义命令不在 allowlist → 明确失败原因。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    _, res = run_runner(ctx, "eval-g3-cmd", ctx.repo, ctx.base_commit,
                        agent_cmd="true", test_command="./run_tests.sh")
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    if row and row["status"] == "failed" and row["fail_reason"] == "test_not_allowlisted":
        return Result.ok("不在 allowlist 的自定义命令应被拒并给出明确原因",
                         f"status={row['status']} fail_reason={row['fail_reason']} note={row['blocked_note']!r}")
    return Result.fail("不在 allowlist 的自定义命令应置 failed(test_not_allowlisted)",
                       f"status={(row or {}).get('status')!r} fail_reason={(row or {}).get('fail_reason')!r}",
                       repro="python3 scripts/eval_phase1.py --case g3_custom_cmd_not_allowlist")


def c_g4_submit_normal(ctx: Ctx) -> Result:
    """G4 正向：submit_evidence 正常签发回执。"""
    if not has_submit_evidence():
        return Result.skip("MCP submit_evidence 未落地")
    ctx.start_bridge()
    if not wait_http(ctx.port):
        return Result.fail("bridge 应在 15s 内响应 /health", "未响应")
    run_id, token = make_run_with_token(ctx)
    if not run_id:
        return Result.fail("make_run_with_token 应产生 runId", "")
    status, res = mcp_tool_call(ctx.port, "agent_office_submit_evidence",
                                {"runId": run_id, "claim": {"done": True}},
                                run_token=token)
    receipt = res.get("receipt") if isinstance(res, dict) else None
    if isinstance(res, dict) and res.get("ok") and receipt and receipt.get("runId") == run_id:
        return Result.ok("持有效 run token 的 submit_evidence 应签发回执",
                         f"ok={res.get('ok')} claimHash={(receipt.get('claimHash') or '')[:16]}…",
                         evidence=str(ctx.state_dir / "agent-office.db"))
    return Result.fail("持有效 run token 的 submit_evidence 应签发回执",
                       f"status={status} res={res}",
                       repro="python3 scripts/eval_phase1.py --case g4_submit_normal")


def c_g4_forged_runid(ctx: Ctx) -> Result:
    """G4 反向：伪造 runId → 拒绝。"""
    if not has_submit_evidence():
        return Result.skip("MCP submit_evidence 未落地")
    ctx.start_bridge()
    if not wait_http(ctx.port):
        return Result.fail("bridge 应在 15s 内响应 /health", "未响应")
    _, token = make_run_with_token(ctx)
    status, res = mcp_tool_call(ctx.port, "agent_office_submit_evidence",
                                {"runId": "run-forged-eval", "claim": {"x": 1}},
                                run_token=token)
    if isinstance(res, dict) and not res.get("ok") and "runId" in str(res.get("error", "")):
        return Result.ok("伪造 runId 的 submit_evidence 应被拒", f"error={res.get('error')!r}")
    return Result.fail("伪造 runId 的 submit_evidence 应被拒",
                       f"status={status} res={res}",
                       repro="python3 scripts/eval_phase1.py --case g4_forged_runid")


def c_g4_missing_token(ctx: Ctx) -> Result:
    """G4 反向：缺 run token → 拒绝。"""
    if not has_submit_evidence():
        return Result.skip("MCP submit_evidence 未落地")
    ctx.start_bridge()
    if not wait_http(ctx.port):
        return Result.fail("bridge 应在 15s 内响应 /health", "未响应")
    run_id, _ = make_run_with_token(ctx)
    status, res = mcp_tool_call(ctx.port, "agent_office_submit_evidence",
                                {"runId": run_id, "claim": {"x": 1}},
                                run_token=None)
    if isinstance(res, dict) and not res.get("ok") and "token" in str(res.get("error", "")).lower():
        return Result.ok("缺 AGENT_OFFICE_RUN_TOKEN 的 submit_evidence 应被拒",
                         f"error={res.get('error')!r}")
    return Result.fail("缺 AGENT_OFFICE_RUN_TOKEN 的 submit_evidence 应被拒",
                       f"status={status} res={res}",
                       repro="python3 scripts/eval_phase1.py --case g4_missing_token")


def c_g4_duplicate_submit(ctx: Ctx) -> Result:
    """G4 反向：重复提交 → 拒绝。"""
    if not has_submit_evidence():
        return Result.skip("MCP submit_evidence 未落地")
    ctx.start_bridge()
    if not wait_http(ctx.port):
        return Result.fail("bridge 应在 15s 内响应 /health", "未响应")
    run_id, token = make_run_with_token(ctx)
    _, first = mcp_tool_call(ctx.port, "agent_office_submit_evidence",
                             {"runId": run_id, "claim": {"done": True}}, run_token=token)
    _, second = mcp_tool_call(ctx.port, "agent_office_submit_evidence",
                              {"runId": run_id, "claim": {"done": True}}, run_token=token)
    if (isinstance(first, dict) and first.get("ok")
            and isinstance(second, dict) and not second.get("ok")
            and "already" in str(second.get("error", ""))):
        return Result.ok("同一 run 重复 submit_evidence 应被拒", f"error={second.get('error')!r}")
    return Result.fail("同一 run 重复 submit_evidence 应被拒（首次成功、二次拒绝）",
                       f"first={first} second={second}",
                       repro="python3 scripts/eval_phase1.py --case g4_duplicate_submit")


def c_g4_agent_hash_ignored(ctx: Ctx) -> Result:
    """G4 正向：Agent 提交的 hash 字段被忽略（篡改 hash 不影响最终证据）。"""
    if not has_submit_evidence():
        return Result.skip("MCP submit_evidence 未落地")
    ctx.start_bridge()
    if not wait_http(ctx.port):
        return Result.fail("bridge 应在 15s 内响应 /health", "未响应")
    run_id, token = make_run_with_token(ctx)
    evil_claim = {"ok": True, "note": "x", "diffHash": "evil-forged-hash",
                  "testOutputHash": "evil-2", "claimHash": "evil-3"}
    status, res = mcp_tool_call(ctx.port, "agent_office_submit_evidence",
                                {"runId": run_id, "claim": evil_claim}, run_token=token)
    if not (isinstance(res, dict) and res.get("ok")):
        return Result.fail("submit 应成功（仅 hash 字段应被忽略）", f"status={status} res={res}")
    conn = ctx.db()
    try:
        row = conn.execute(
            "SELECT content FROM run_evidence WHERE run_id=? AND kind='claim' "
            "ORDER BY created_at DESC LIMIT 1", (run_id,)).fetchone()
    finally:
        conn.close()
    stored = json.loads(row["content"]) if row else {}
    receipt = res.get("receipt") or {}
    expected_claim_hash = hashlib.sha256(
        json.dumps({"note": "x", "ok": True}, sort_keys=True,
                   separators=(",", ":")).encode()).hexdigest()
    if ("diffHash" not in stored and "claimHash" not in stored
            and "testOutputHash" not in stored
            and receipt.get("claimHash") == expected_claim_hash):
        return Result.ok("Agent claim 里的 hash 字段应被忽略、由 bridge 重算",
                         f"stored_keys={sorted(stored)} claimHash={(receipt.get('claimHash') or '')[:16]}…",
                         evidence=str(ctx.state_dir / "agent-office.db"))
    return Result.fail("Agent claim 里的 hash 字段应被忽略",
                       f"stored={stored} receipt={receipt}",
                       repro="python3 scripts/eval_phase1.py --case g4_agent_hash_ignored")


def c_tamper_pinned(ctx: Ctx) -> Result:
    """测试篡改（反向）：pinnedTests 被改 → 不得自动 done。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    (ctx.repo / "tests").mkdir(exist_ok=True)
    (ctx.repo / "tests" / "test_pinned.py").write_text(
        "import unittest\nclass T(unittest.TestCase):\n    def test_a(self):\n        self.assertTrue(True)\n",
        encoding="utf-8")
    agent_cmd = f"{PY} -c \"open('{ctx.repo}/tests/test_pinned.py','w').write('tampered')\""
    _, res = run_runner(ctx, "eval-tamp-pin", ctx.repo, ctx.base_commit,
                        agent_cmd=agent_cmd, pinned_tests='["tests/test_pinned.py"]')
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    if row and row["status"] == "waiting_approval" and row["review_reason"] == "tampered_test":
        return Result.ok("pinnedTests 被改应标 tampered_test、不得自动 done",
                         f"status={row['status']} review_reason={row['review_reason']} tampered={res.get('tampered_pinned')}")
    return Result.fail("pinnedTests 被改应标 tampered_test",
                       f"status={(row or {}).get('status')!r} review_reason={(row or {}).get('review_reason')!r}",
                       repro="python3 scripts/eval_phase1.py --case tamper_pinned")


def c_tamper_config(ctx: Ctx) -> Result:
    """测试篡改（反向）：conftest/pytest.ini/package.json scripts 被改 → 拦截。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    (ctx.repo / "conftest.py").write_text("pytest_plugins = []\n", encoding="utf-8")
    agent_cmd = f"{PY} -c \"open('{ctx.repo}/conftest.py','w').write('tampered-config')\""
    _, res = run_runner(ctx, "eval-tamp-cfg", ctx.repo, ctx.base_commit,
                        agent_cmd=agent_cmd, pinned_tests='["conftest.py"]')
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    if row and row["status"] == "waiting_approval" and row["review_reason"] == "tampered_test":
        return Result.ok("测试配置（conftest.py）被改应拦截（进 pinned 面即 tampered_test）",
                         f"status={row['status']} review_reason={row['review_reason']}")
    return Result.fail("测试配置被改应标 tampered_test",
                       f"status={(row or {}).get('status')!r} review_reason={(row or {}).get('review_reason')!r}",
                       repro="python3 scripts/eval_phase1.py --case tamper_config")


def c_tamper_deliverable(ctx: Ctx) -> Result:
    """测试篡改（正向）：deliverableTests 新增 → 允许并记录。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    (ctx.repo / "tests").mkdir(exist_ok=True)
    agent_cmd = (f"{PY} -c \"import os; os.makedirs('{ctx.repo}/tests', exist_ok=True); "
                 f"open('{ctx.repo}/tests/test_new.py','w').write('import unittest')\"")
    _, res = run_runner(ctx, "eval-tamp-del", ctx.repo, ctx.base_commit,
                        agent_cmd=agent_cmd, deliverable_tests='["tests/test_new.py"]')
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    changed = res.get("deliverable_tests_changed") or []
    if "tests/test_new.py" in changed:
        return Result.ok("deliverableTests 新增应作为证据允许并记录",
                         f"deliverable_tests_changed={changed} status={res.get('status')}",
                         evidence=str(ctx.state_dir / "agent-office.db"))
    return Result.fail("deliverableTests 新增应被记录为 deliverable_tests_changed",
                       f"changed={changed} res={res}",
                       repro="python3 scripts/eval_phase1.py --case tamper_deliverable")


def c_approval_modify_after(ctx: Ctx) -> Result:
    """审批（反向）：批准后修改工作区 → 审批失效、merge 阻断。"""
    if not (has_runner() and has_bridge()):
        return Result.skip("runner 或 bridge 实现未落地")
    ctx.start_bridge()
    if not wait_http(ctx.port):
        return Result.fail("bridge 应在 15s 内响应 /health", "未响应")
    _, res = run_agent_writes(ctx, "eval-ama")
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    if not row or row["status"] != "waiting_approval":
        return Result.fail("run 应先进入 waiting_approval",
                           f"status={(row or {}).get('status')!r} res={res}")
    # 批准（run 收集完）之后，工作区又被改动 → merge 必须失效
    (ctx.repo / "y.txt").write_text("tampered-after-approval", encoding="utf-8")
    status, payload = browser_post(ctx.port, f"/runs/{run_id}/merge")
    if status == 409 and (payload or {}).get("code") == "worktree_modified":
        return Result.ok("批准后改动工作区应使审批失效并阻断 merge",
                         f"status={status} code={(payload or {}).get('code')!r}",
                         evidence=str(ctx.state_dir / "agent-office.db"))
    return Result.fail("批准后改动工作区应使审批失效并阻断 merge",
                       f"status={status} payload={payload}",
                       repro="python3 scripts/eval_phase1.py --case approval_modify_after")


def c_approval_diff_base(ctx: Ctx) -> Result:
    """审批（反向）：同一 diff 不同 baseCommit → 审批不通用。"""
    if not (has_runner() and has_bridge()):
        return Result.skip("runner 或 bridge 实现未落地")
    ctx.start_bridge()
    if not wait_http(ctx.port):
        return Result.fail("bridge 应在 15s 内响应 /health", "未响应")
    _, res = run_agent_writes(ctx, "eval-adb")
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    if not row or row["status"] != "waiting_approval":
        return Result.fail("run 应先进入 waiting_approval",
                           f"status={(row or {}).get('status')!r}")
    # 工作区 base 前移（把 diff 落成一个新 base 提交），审批绑定旧 base → 不通用
    subprocess.run(["git", "-C", str(ctx.repo), "add", "-A"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(ctx.repo), "commit", "-q", "-m", "advance base"],
                   check=True, capture_output=True)
    status, payload = browser_post(ctx.port, f"/runs/{run_id}/merge")
    if status == 409 and (payload or {}).get("code") in ("base_mismatch", "worktree_modified"):
        return Result.ok("同一 diff 在不同 baseCommit 上不应通用（审批绑定 base）",
                         f"status={status} code={(payload or {}).get('code')!r}",
                         evidence=str(ctx.state_dir / "agent-office.db"))
    return Result.fail("同一 diff 在不同 baseCommit 上不应通用",
                       f"status={status} payload={payload}",
                       repro="python3 scripts/eval_phase1.py --case approval_diff_base")


def c_approval_not_stopped(ctx: Ctx) -> Result:
    """审批（反向）：审批前 run 未 stop → 拒绝 merge。"""
    if not (has_runner() and has_bridge()):
        return Result.skip("runner 或 bridge 实现未落地")
    ctx.start_bridge()
    if not wait_http(ctx.port):
        return Result.fail("bridge 应在 15s 内响应 /health", "未响应")
    # 先落一个 schema（任意一次 runner 即可），再直接造一条仍在 running 的 run
    run_agent_writes(ctx, "eval-ans-seed")
    conn = ctx.db()
    try:
        conn.execute(
            "INSERT INTO runs(id, task_id, mission_id, status, worktree_path, "
            "base_commit, head_commit, heartbeat_at, started_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            ("run-still-running", "eval-ans", "", "running", str(ctx.repo),
             ctx.base_commit, ctx.base_commit,
             "2026-11-28T00:00:00Z", "2026-11-28T00:00:00Z"))
        conn.commit()
    finally:
        conn.close()
    status, payload = browser_post(ctx.port, "/runs/run-still-running/merge")
    if status == 409 and (payload or {}).get("code") == "not_stopped":
        return Result.ok("run 未停止前应拒绝 merge",
                         f"status={status} code={(payload or {}).get('code')!r}",
                         evidence=str(ctx.state_dir / "agent-office.db"))
    return Result.fail("run 未停止前应拒绝 merge",
                       f"status={status} payload={payload}",
                       repro="python3 scripts/eval_phase1.py --case approval_not_stopped")


def c_restart_orphan(ctx: Ctx) -> Result:
    """重启（正/反）：run 中 kill bridge 再启动 → 无主 run 不得永远 running。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    # 先落 schema（任意一次 runner），再造一条心跳早已过期的 running run
    run_agent_writes(ctx, "eval-ro-seed")
    conn = ctx.db()
    try:
        conn.execute(
            "INSERT INTO runs(id, task_id, mission_id, status, worktree_path, "
            "base_commit, head_commit, heartbeat_at, started_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            ("run-orphan", "eval-ro", "", "running", str(ctx.repo),
             ctx.base_commit, ctx.base_commit,
             "2000-01-01T00:00:00Z", "2000-01-01T00:00:00Z"))
        conn.commit()
    finally:
        conn.close()
    # bridge 启动时扫描并回收无主 run（recover_orphaned_runs 在 serve 前同步执行）
    ctx.start_bridge()
    if not wait_http(ctx.port):
        return Result.fail("bridge 应在 15s 内响应 /health", "未响应")
    row = get_run_row(ctx, "run-orphan")
    if row and row["status"] == "failed" and row["fail_reason"] == "orphaned":
        return Result.ok("bridge 重启后无主 run 应归 failed(orphaned)，不得永远 running",
                         f"status={row['status']} fail_reason={row['fail_reason']}",
                         evidence=str(ctx.state_dir / "agent-office.db"))
    return Result.fail("bridge 重启后无主 run 应归 failed(orphaned)",
                       f"status={(row or {}).get('status')!r} fail_reason={(row or {}).get('fail_reason')!r}",
                       repro="python3 scripts/eval_phase1.py --case restart_orphan")


def c_isolation_second_bridge(ctx: Ctx) -> Result:
    """隔离（反向）：第二个 bridge 共用 STATE_DIR → 拒绝启动。"""
    ctx.start_bridge()
    if not wait_http(ctx.port):
        return Result.fail("首个 bridge 应在 15s 内响应 /health", "未响应")
    # 第二个 bridge 复用同一 state_dir，应拒绝启动（单实例锁，见安全评审 #6）
    p = subprocess.Popen(
        [PY, str(BRIDGE_PY), "--host", "127.0.0.1", "--port", str(free_port())],
        env={**os.environ, **ctx.bridge_env()},
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True,
    )
    try:
        out, _ = p.communicate(timeout=8)
    except subprocess.TimeoutExpired:
        kill_group(p)
        return Result.fail("第二个 bridge 共用 STATE_DIR 应拒绝启动（单实例锁）",
                           "第二个实例持续运行未退出",
                           repro="python3 bridge.py --port <other>  (同一 BRIDGE_STATE_DIR)")
    if p.returncode != 0:
        return Result.ok("第二个 bridge 共用 STATE_DIR 应拒绝启动", f"退出码 {p.returncode}",
                         evidence=str(ctx.tmp / "bridge.log"))
    return Result.fail("第二个 bridge 共用 STATE_DIR 应拒绝启动（单实例锁）",
                       f"第二个实例正常启动退出码 0（out={out[:200]!r}）",
                       repro="python3 bridge.py --port <other>  (同一 BRIDGE_STATE_DIR)")


def c_isolation_expected_paths_conflict(ctx: Ctx) -> Result:
    """隔离（反向）：两个任务 expectedPaths 冲突 → 串行或报冲突。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    expected = json.dumps(["src/shared"])
    agent_cmd = (f"{PY} -c \"import os; "
                 f"os.makedirs('{ctx.repo}/src/shared', exist_ok=True); "
                 f"open('{ctx.repo}/src/shared/a.txt','w').write('a')\"")
    _, res1 = run_runner(ctx, "eval-conf-1", ctx.repo, ctx.base_commit,
                         agent_cmd=agent_cmd, expected_paths=expected)
    run1 = res1.get("runId")
    if not run1:
        return Result.fail("第一个 run 应返回 runId", json.dumps(res1, ensure_ascii=False))
    row1 = get_run_row(ctx, run1)
    if not row1 or row1["status"] != "waiting_approval":
        return Result.fail("第一个 run 应处于 in-flight(waiting_approval)",
                           f"status={(row1 or {}).get('status')!r} res={res1}")
    # 第二个任务 expectedPaths 重叠 → 应在开工前报冲突，不得并发跑
    _, res2 = run_runner(ctx, "eval-conf-2", ctx.repo, ctx.base_commit,
                         agent_cmd=agent_cmd, expected_paths=expected)
    if res2.get("status") == "failed" and res2.get("fail_reason") == "expected_paths_conflict":
        return Result.ok("expectedPaths 有交集的两个任务应串行化/报冲突",
                         f"fail_reason={res2.get('fail_reason')!r} note={res2.get('note')!r}",
                         evidence=str(ctx.state_dir / "agent-office.db"))
    return Result.fail("expectedPaths 有交集的两个任务应报冲突",
                       f"res2={res2}",
                       repro="python3 scripts/eval_phase1.py --case isolation_expected_paths_conflict")


def c_migration_10x(ctx: Ctx) -> Result:
    """迁移（正向）：真实 missions.json 样本迁移 10 次 + 随机 SIGKILL，行数/校验和一致。"""
    if not has_migration():
        return Result.skip("migration.py 未落地")
    src = make_sample_missions_json(ctx, n_missions=60)
    base_args = [PY, str(MIGRATION_PY), "--state-dir", str(ctx.state_dir),
                 "migrate", "--source", str(src)]
    r0 = run_cmd(base_args, ctx.tmp, ctx.bridge_env())
    if r0.returncode != 0:
        return Result.fail("首次 migrate 应成功", f"exit={r0.returncode} err={r0.stderr[:200]!r}",
                           repro="python3 scripts/eval_phase1.py --case migration_10x")
    base = db_checksum(ctx)
    # 幂等：再迁 9 次，校验和必须逐次一致
    for i in range(9):
        r = run_cmd(base_args, ctx.tmp, ctx.bridge_env())
        if r.returncode != 0:
            return Result.fail(f"第 {i + 2} 次 migrate 应成功（幂等）",
                               f"exit={r.returncode} err={r.stderr[:200]!r}")
        cur = db_checksum(ctx)
        if cur != base:
            return Result.fail("重复 migrate 应保持行数/校验和一致",
                               f"第 {i + 2} 次不一致: base={base} cur={cur}")
    # kill-safety：带延迟的 migrate 中途 SIGKILL，再迁一次应恢复并一致
    slow_env = {**ctx.bridge_env(), "AGENT_OFFICE_MIGRATION_DELAY_MS": "300"}
    p = ctx.spawn(base_args, env=slow_env)
    time.sleep(0.6)
    kill_group(p)
    r = run_cmd(base_args, ctx.tmp, ctx.bridge_env())
    if r.returncode != 0:
        return Result.fail("SIGKILL 后重新 migrate 应成功恢复",
                           f"exit={r.returncode} err={r.stderr[:200]!r}")
    if db_checksum(ctx) != base:
        return Result.fail("SIGKILL 中断后重迁应恢复至一致校验和",
                           f"base={base} after={db_checksum(ctx)}")
    total = sum(v["n"] for v in base.values())
    return Result.ok("样本迁移 10 次 + 随机 SIGKILL 后行数/校验和一致",
                     f"rows={total} checksum_stable=True",
                     evidence=str(ctx.state_dir / "agent-office.db"))


def c_migration_rollback(ctx: Ctx) -> Result:
    """迁移（正向）：回退路径可用。"""
    if not has_migration():
        return Result.skip("migration.py 未落地")
    src = make_sample_missions_json(ctx, n_missions=20)
    migrate_args = [PY, str(MIGRATION_PY), "--state-dir", str(ctx.state_dir),
                    "migrate", "--source", str(src)]
    r = run_cmd(migrate_args, ctx.tmp, ctx.bridge_env())
    if r.returncode != 0:
        return Result.fail("migrate 应成功", f"exit={r.returncode} err={r.stderr[:200]!r}",
                           repro="python3 scripts/eval_phase1.py --case migration_rollback")
    # post-cutover 写入：直接落一条新 mission 到 SQLite
    conn = ctx.db()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO missions(id, status, data) VALUES (?,?,?)",
            ("msn-postcutover", "active", json.dumps({"id": "msn-postcutover", "title": "post"})))
        conn.commit()
    finally:
        conn.close()
    rollback_args = [PY, str(MIGRATION_PY), "--state-dir", str(ctx.state_dir),
                     "rollback", "--source", str(src)]
    r = run_cmd(rollback_args, ctx.tmp, ctx.bridge_env())
    if r.returncode != 0:
        return Result.fail("rollback 应成功", f"exit={r.returncode} err={r.stderr[:200]!r}")
    rebuilt = json.loads(src.read_text("utf-8"))
    ids = [m.get("id") for m in rebuilt.get("missions", [])]
    if "msn-postcutover" in ids:
        return Result.ok("cutover 后回退可用且不丢 post-cutover 写入",
                         f"missions={len(ids)} postcutover_preserved=True",
                         evidence=str(src))
    return Result.fail("rollback 重建的 JSON 应含 post-cutover 写入的 mission",
                       f"mission_ids={ids[:5]}…",
                       repro="python3 scripts/eval_phase1.py --case migration_rollback")


def c_view_5state_map(ctx: Ctx) -> Result:
    """视图（正向）：run 状态只出现 queued/running/waiting_approval/failed/done 五态。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    allowed = {"queued", "running", "waiting_approval", "failed", "done"}
    # 三种场景：成功（有 diff）、非零退出、空跑
    run_runner(ctx, "eval-5a", ctx.repo, ctx.base_commit,
               agent_cmd=f"{PY} -c \"open('{ctx.repo}/a.txt','w').write('a')\"")
    run_runner(ctx, "eval-5b", ctx.repo, ctx.base_commit,
               agent_cmd=f"{PY} -c \"import sys; sys.exit(1)\"")
    run_runner(ctx, "eval-5c", ctx.repo, ctx.base_commit, agent_cmd="true")
    conn = ctx.db()
    try:
        statuses = [r["status"] for r in conn.execute("SELECT status FROM runs").fetchall()]
    finally:
        conn.close()
    if statuses and all(s in allowed for s in statuses):
        return Result.ok("run 状态只出现 queued/running/waiting_approval/failed/done 五态",
                         f"statuses={sorted(set(statuses))}",
                         evidence=str(ctx.state_dir / "agent-office.db"))
    return Result.fail("run 状态应只属于五态集合",
                       f"statuses={statuses}",
                       repro="python3 scripts/eval_phase1.py --case view_5state_map")


def c_view_kill_5s(ctx: Ctx) -> Result:
    """视图（正向）：kill 后 ≤5s 事件流出现失败。"""
    if not (has_runner() and has_bridge()):
        return Result.skip("runner 或 bridge 实现未落地")
    ctx.start_bridge()
    if not wait_http(ctx.port):
        return Result.fail("bridge 应在 15s 内响应 /health", "未响应")
    # 后台跑一个长 runner，进入 running 并记录 session_pgid
    agent_cmd = f"{PY} -c \"import time; time.sleep(60)\""
    ctx.spawn([PY, str(RUNNER_PY), "--task-id", "eval-kill",
               "--worktree", str(ctx.repo), "--base-commit", ctx.base_commit,
               "--agent-cmd", agent_cmd])
    run_id = None
    deadline = time.time() + 15
    while time.time() < deadline:
        db_path = ctx.state_dir / "agent-office.db"
        if db_path.exists():
            conn = sqlite3.connect(str(db_path))
            conn.row_factory = sqlite3.Row
            try:
                row = conn.execute(
                    "SELECT id FROM runs WHERE task_id='eval-kill' AND status='running' "
                    "AND session_pgid IS NOT NULL").fetchone()
                if row:
                    run_id = row["id"]
                    conn.close()
                    break
            finally:
                conn.close()
        time.sleep(0.1)
    if not run_id:
        return Result.fail("runner 应进入 running 并记录 session_pgid", "未等到 running")
    t0 = time.time()
    status, payload = browser_post(ctx.port, f"/runs/{run_id}/kill")
    ok = False
    while time.time() - t0 < 5:
        row = get_run_row(ctx, run_id)
        if row and row["status"] == "failed" and row["fail_reason"] == "killed":
            ok = True
            break
        time.sleep(0.1)
    if not ok:
        return Result.fail("kill 后 ≤5s 事件流应出现 failed(killed)",
                           f"status={status} payload={payload} run={(get_run_row(ctx, run_id) or {}).get('status')!r}")
    conn = ctx.db()
    try:
        ev = conn.execute(
            "SELECT id FROM events WHERE type='kill' AND resource_id=?", (run_id,)).fetchone()
    finally:
        conn.close()
    if ev:
        return Result.ok("kill 后 ≤5s 事件流出现 failed(killed)",
                         f"run_status=failed kill_event=True",
                         evidence=str(ctx.state_dir / "agent-office.db"))
    return Result.fail("kill 后应写入 kill 事件到事件流",
                       "SQLite events 无 type='kill' 记录",
                       repro="python3 scripts/eval_phase1.py --case view_kill_5s")


def c_negative_reason(ctx: Ctx) -> Result:
    """负向通用：每类失败必须给出可读 reason 与证据，不能只回 500。"""
    ctx.start_bridge()
    if not wait_http(ctx.port):
        return Result.fail("bridge 应在 15s 内响应 /health", "未响应")
    # 现有 bridge 对未知路径返回 404（带可读体），以此验证「失败带可读 reason」的基础面
    status, _, body = http_request("GET", ctx.port, "/no-such-route-eval")
    if status in (404, 405) and body:
        return Result.ok("失败响应应带可读 reason 而非裸 500",
                         f"status={status} body={body[:120]!r}",
                         evidence=str(ctx.tmp / "bridge.log"))
    return Result.fail("失败响应应带可读 reason 而非裸 500",
                       f"status={status} body={body[:120]!r}",
                       repro="curl -i http://127.0.0.1:<port>/no-such-route-eval")


def c_git_boundary_block(ctx: Ctx) -> Result:
    """第 3 条 git 边界（拦）：Agent 尝试 git push → 被薄包装拦 + 100% 留痕。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    agent_cmd = "git push origin main"
    _, res = run_runner(ctx, "eval-gitb", ctx.repo, ctx.base_commit, agent_cmd=agent_cmd)
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    conn = ctx.db()
    try:
        rows = conn.execute(
            "SELECT payload FROM events WHERE type='git' AND resource_id=?",
            (run_id,)).fetchall()
    finally:
        conn.close()
    blocked = [r for r in rows if json.loads(r["payload"]).get("blocked")]
    if row and row["status"] == "failed" and row["fail_reason"] == "git_boundary" and blocked:
        return Result.ok("git push 应被薄包装拦（failed/git_boundary）并 100% 留痕",
                         f"fail_reason={row['fail_reason']!r} git_events={len(rows)} blocked={len(blocked)}",
                         evidence=str(ctx.state_dir / "agent-office.db"))
    return Result.fail("git push 应被薄包装拦并 100% 留痕",
                       f"status={(row or {}).get('status')!r} fail_reason={(row or {}).get('fail_reason')!r} git_events={len(rows)} blocked={len(blocked)}",
                       repro="python3 scripts/eval_phase1.py --case git_boundary_block")


def c_git_boundary_log(ctx: Ctx) -> Result:
    """第 3 条 git 边界（放行+留痕）：Agent 走安全 git 命令 → 放行且 100% 留痕。"""
    if not has_runner():
        return Result.skip("runner 实现未落地")
    agent_cmd = f"git status >/dev/null; {PY} -c \"open('{ctx.repo}/x.txt','w').write('hi')\""
    _, res = run_runner(ctx, "eval-gitlog", ctx.repo, ctx.base_commit, agent_cmd=agent_cmd)
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    conn = ctx.db()
    try:
        rows = conn.execute(
            "SELECT payload FROM events WHERE type='git' AND resource_id=?",
            (run_id,)).fetchall()
    finally:
        conn.close()
    if row and row["status"] == "waiting_approval" and not row["fail_reason"] and rows:
        return Result.ok("安全 git 命令应放行（不拦截）并 100% 留痕",
                         f"status={row['status']} git_events={len(rows)}",
                         evidence=str(ctx.state_dir / "agent-office.db"))
    return Result.fail("安全 git 命令应放行并 100% 留痕",
                       f"status={(row or {}).get('status')!r} fail_reason={(row or {}).get('fail_reason')!r} git_events={len(rows)}",
                       repro="python3 scripts/eval_phase1.py --case git_boundary_log")


def c_metric_ttm(ctx: Ctx) -> Result:
    """第 10 条指标：merge 后 merged_at 落库、time-to-trusted-merge 可算、post_merge_defects 默认 0。"""
    if not (has_runner() and has_bridge()):
        return Result.skip("runner 或 bridge 实现未落地")
    ctx.start_bridge()
    if not wait_http(ctx.port):
        return Result.fail("bridge 应在 15s 内响应 /health", "未响应")
    _, res = run_agent_writes(ctx, "eval-ttm")
    run_id = res.get("runId")
    if not run_id:
        return Result.fail("runner 应返回 runId", json.dumps(res, ensure_ascii=False))
    row = get_run_row(ctx, run_id)
    if not row or row["status"] != "waiting_approval":
        return Result.fail("run 应先进入 waiting_approval",
                           f"status={(row or {}).get('status')!r}")
    status, payload = browser_post(ctx.port, f"/runs/{run_id}/merge")
    if status != 200:
        return Result.fail("merge 应成功", f"status={status} payload={payload}")
    row = get_run_row(ctx, run_id)
    conn = ctx.db()
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(runs)").fetchall()}
        defects = conn.execute(
            "SELECT post_merge_defects FROM runs WHERE id=?", (run_id,)).fetchone()[0]
    finally:
        conn.close()
    merged_at = (row or {}).get("merged_at")
    started_at = (row or {}).get("started_at")
    ttm_ok = bool(merged_at and started_at and merged_at >= started_at)
    if (row and row["status"] == "done" and "post_merge_defects" in cols
            and ttm_ok and defects == 0):
        return Result.ok("merge 后 merged_at 落库、time-to-trusted-merge 可算、post_merge_defects 默认 0",
                         f"status={row['status']} merged_at={merged_at!r} defects={defects}",
                         evidence=str(ctx.state_dir / "agent-office.db"))
    return Result.fail("merge 后应落 merged_at、可算 time-to-trusted-merge、post_merge_defects 默认 0",
                       f"status={(row or {}).get('status')!r} merged_at={merged_at!r} started_at={started_at!r} defects={defects} cols_has_post={('post_merge_defects' in cols)}",
                       repro="python3 scripts/eval_phase1.py --case metric_ttm")


# --------------------------------------------------------------------------- #
# 用例注册表
# --------------------------------------------------------------------------- #

CASES = [
    ("g1_exit0_done", "G1 退出码 0 → done", "RUNNER_DESIGN §1 G1", c_g1_exit0_done),
    ("g1_nonzero_fail", "G1 退出码非 0 → 不得 done", "RUNNER_DESIGN §1 G1", c_g1_nonzero_fail),
    ("g1_timeout_fail", "G1 超时 → 不得 done", "RUNNER_DESIGN §1 G1", c_g1_timeout_fail),
    ("g1_sigkill_fail", "G1 SIGKILL → 不得 done", "RUNNER_DESIGN §1 G1", c_g1_sigkill_fail),
    ("g2_diff_pass", "G2 有 diff → 通过", "RUNNER_DESIGN §1 G2", c_g2_diff_pass),
    ("g2_empty_diff_blocked", "G2 空 diff 无 claim → blocked", "RUNNER_DESIGN §1 G2", c_g2_empty_diff_blocked),
    ("g2_empty_diff_claim_review", "G2 空 diff + claim → 人审", "RUNNER_DESIGN §1 G2", c_g2_empty_diff_claim_review),
    ("g2_untracked_in_diff", "G2 untracked 进 diffHash", "RUNNER_DESIGN §12 B3", c_g2_untracked_in_diff),
    ("g3_test_pass", "G3 测试通过 → done", "RUNNER_DESIGN §1 G3", c_g3_test_pass),
    ("g3_test_fail", "G3 测试失败 → 不得 done", "RUNNER_DESIGN §1 G3", c_g3_test_fail),
    ("g3_no_tests_doc", "G3 文档类 no_tests 不静默 done", "RUNNER_DESIGN §12 B2", c_g3_no_tests_doc),
    ("g3_custom_cmd_not_allowlist", "G3 自定义命令不在 allowlist → 明确原因", "RUNNER_DESIGN §12 B2", c_g3_custom_cmd_not_allowlist),
    ("g4_submit_normal", "G4 submit_evidence 正常签发回执", "RUNNER_DESIGN §2 G4", c_g4_submit_normal),
    ("g4_forged_runid", "G4 伪造 runId → 拒绝", "RUNNER_DESIGN §2 B8", c_g4_forged_runid),
    ("g4_missing_token", "G4 缺 run token → 拒绝", "RUNNER_DESIGN §2 B8", c_g4_missing_token),
    ("g4_duplicate_submit", "G4 重复提交 → 拒绝", "RUNNER_DESIGN §2 G4", c_g4_duplicate_submit),
    ("g4_agent_hash_ignored", "G4 Agent hash 被忽略", "RUNNER_DESIGN §2", c_g4_agent_hash_ignored),
    ("tamper_pinned", "pinnedTests 被改 → 拦截", "RUNNER_DESIGN §6", c_tamper_pinned),
    ("tamper_config", "conftest/pytest.ini/package.json 被改 → 拦截", "RUNNER_DESIGN §6 B4", c_tamper_config),
    ("tamper_deliverable", "deliverableTests 新增 → 允许并记录", "RUNNER_DESIGN §6", c_tamper_deliverable),
    ("approval_modify_after", "批准后改工作区 → 审批失效", "RUNNER_DESIGN §8 B5", c_approval_modify_after),
    ("approval_diff_base", "同 diff 不同 base → 审批不通用", "RUNNER_DESIGN §8 B5", c_approval_diff_base),
    ("approval_not_stopped", "审批前未 stop → 拒 merge", "RUNNER_DESIGN §8 B5", c_approval_not_stopped),
    ("restart_orphan", "bridge 重启无主 run 不得永远 running", "RUNNER_DESIGN §9 A3", c_restart_orphan),
    ("isolation_second_bridge", "第二 bridge 共用 STATE_DIR → 拒绝", "安全评审 #6", c_isolation_second_bridge),
    ("isolation_expected_paths_conflict", "expectedPaths 冲突 → 串行/报冲突", "RUNNER_DESIGN §4", c_isolation_expected_paths_conflict),
    ("migration_10x", "迁移 10 次 + SIGKILL 一致", "RUNNER_DESIGN §7 B6", c_migration_10x),
    ("migration_rollback", "迁移回退可用", "RUNNER_DESIGN §7 B6", c_migration_rollback),
    ("view_5state_map", "run 5 态 ↔ task 状态映射", "RUNNER_DESIGN §9 B7", c_view_5state_map),
    ("view_kill_5s", "kill 后 ≤5s 事件流 failed", "RUNNER_DESIGN §9", c_view_kill_5s),
    ("negative_reason", "每类失败带可读 reason + 证据", "RUNNER_DESIGN §9 C5", c_negative_reason),
    ("git_boundary_block", "git push 被薄包装拦 + 100% 留痕", "RUNNER_DESIGN §3", c_git_boundary_block),
    ("git_boundary_log", "安全 git 命令放行 + 100% 留痕", "RUNNER_DESIGN §3", c_git_boundary_log),
    ("metric_ttm", "merge 落 merged_at、time-to-trusted-merge 可算", "RUNNER_DESIGN §10", c_metric_ttm),
]

CASES_BY_ID = {c[0]: c for c in CASES}


def git_commit() -> str:
    r = subprocess.run(["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
                       capture_output=True, text=True)
    return r.stdout.strip()


def run_one(case_id: str) -> dict:
    title = CASES_BY_ID[case_id][1]
    clause = CASES_BY_ID[case_id][2]
    fn = CASES_BY_ID[case_id][3]
    ctx = Ctx(case_id)
    t0 = time.time()
    expected = ""
    actual = ""
    status = "fail"
    evidence = ""
    repro = ""
    try:
        res = fn(ctx)
        status, expected, actual = res.status, res.expected, res.actual
        evidence, repro = res.evidence, res.repro
    except subprocess.TimeoutExpired as e:
        status, expected = "fail", "用例应在 60s 内完成"
        actual = f"超时: {e}"
    except Exception as e:  # noqa: BLE001 — 不把失败吞成 skip，如实记 fail
        status, expected = "fail", "用例不应抛异常"
        actual = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
    finally:
        ctx.cleanup()
    return {
        "id": case_id,
        "title": title,
        "clause": clause,
        "expected": expected,
        "actual": actual,
        "status": status,
        "duration_sec": round(time.time() - t0, 3),
        "evidence_path": evidence,
        "repro": repro,
    }


def main(argv):
    parser = argparse.ArgumentParser(description="Phase 1 黑盒验收评测")
    parser.add_argument("--json", dest="json_path", help="结果 JSON 输出路径")
    parser.add_argument("--case", dest="case_id", help="只跑指定用例 id")
    parser.add_argument("--list", action="store_true", help="列出所有用例")
    args = parser.parse_args(argv)

    if args.list:
        for cid, title, clause, _ in CASES:
            print(f"{cid}\t{clause}\t{title}")
        return 0

    if args.case_id and args.case_id not in CASES_BY_ID:
        print(f"未知用例: {args.case_id}", file=sys.stderr)
        return 2

    before = git_status_snapshot()
    selected = [args.case_id] if args.case_id else [c[0] for c in CASES]

    report = {
        "commit": git_commit(),
        "startedAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "runner_implemented": has_runner(),
        "submit_evidence_implemented": has_submit_evidence(),
        "migration_implemented": has_migration(),
        "summary": {"passed": 0, "failed": 0, "skipped": 0},
        "cases": [],
    }

    t_start = time.time()
    for cid in selected:
        if time.time() - t_start > TOTAL_TIMEOUT:
            report["cases"].append({
                "id": cid, "status": "fail", "expected": "总超时 ≤ 10min",
                "actual": "总时长超出 10min，中止", "duration_sec": 0})
            report["summary"]["failed"] += 1
            continue
        rec = run_one(cid)
        report["summary"][{"pass": "passed", "fail": "failed", "skip": "skipped"}[rec["status"]]] += 1
        report["cases"].append(rec)

    after = git_status_snapshot()
    report["repo_unchanged"] = (before == after)
    report["repo_diff_before_after"] = "" if before == after else f"BEFORE:\n{before}\nAFTER:\n{after}"
    report["finishedAt"] = datetime.datetime.now().astimezone().isoformat(timespec="seconds")

    out = json.dumps(report, ensure_ascii=False, indent=2)
    if args.json_path:
        Path(args.json_path).write_text(out, encoding="utf-8")
    else:
        print(out)

    if report["summary"]["failed"] > 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
