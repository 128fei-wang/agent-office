#!/usr/bin/env python3
"""Phase 1 runner — execute one task in a per-task worktree and record evidence.

Contract (see ``scripts/eval_phase1.py`` CONTRACT block and ``docs/RUNNER_DESIGN.md``):

    python3 runner.py --task-id <T> --worktree <dir> --base-commit <H> \
        [--agent-cmd <cmd>] [--test-command <cmd>] [--claim <json>] \
        [--no-tests] [--expected-paths <json>] [--pinned-tests <json>] \
        [--deliverable-tests <json>] [--mission-id <M>] [--agent-id <A>] \
        [--timeout <seconds>]

env:
    BRIDGE_STATE_DIR  where ``agent-office.db`` (and the receipt key) live
    AGENT_OFFICE_RUN_TOKEN  generated here, injected into the agent subprocess

The runner is the *bridge-side* evidence collector for one worktree: it runs the
agent, then collects the diff (incl. untracked files), test output and exit code
itself and computes every hash — an agent's self-reported hash is never trusted.
It applies the four completion gates (G1–G4) from RUNNER_DESIGN §1 and writes the
result to the SQLite ``runs`` / ``run_evidence`` / ``events`` tables.

Exit code: 0 = run recorded (the run's own status is in the DB); 2 = usage error.
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import agentdb  # noqa: E402


# Custom test commands outside this set are rejected (RUNNER_DESIGN §12 B2).
_ALLOWED_TEST_HINTS = (
    "python3 -m unittest", "python -m unittest", "python3 -m pytest",
    "python -m pytest", "pytest", "unittest", "npm test", "npm run test",
    "node --test", "make test",
)


def _shell(cmd, cwd, timeout, env=None):
    """Run a shell command in its own process group; returns
    (returncode_or_None_on_timeout, output, timed_out)."""
    merged = dict(os.environ)
    if env:
        merged.update(env)
    proc = subprocess.Popen(
        cmd, cwd=str(cwd), env=merged, shell=True,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        start_new_session=True)
    try:
        out, _ = proc.communicate(timeout=timeout)
        return proc.returncode, out.decode("utf-8", "replace"), False
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        try:
            proc.kill()
        except OSError:
            pass
        out, _ = proc.communicate()
        return None, out.decode("utf-8", "replace"), True


def collect_diff(worktree: Path, base_commit: str):
    """Collect diff relative to a fixed base commit, including untracked files.

    ``git add -N`` marks untracked files as intent-to-add so ``git diff`` shows
    them as new files (RUNNER_DESIGN §12 B3). ``git status --porcelain`` is
    captured too, to cover edge cases (renames, deletions) that a plain diff
    against the base can miss.
    """
    git = ["git", "-C", str(worktree)]
    subprocess.run(git + ["add", "-N", "-A"], capture_output=True)
    diff = subprocess.run(git + ["diff", base_commit],
                          capture_output=True, text=True).stdout
    porcelain = subprocess.run(git + ["status", "--porcelain"],
                               capture_output=True, text=True).stdout
    head = subprocess.run(git + ["rev-parse", "HEAD"],
                          capture_output=True, text=True).stdout.strip()
    return diff, porcelain, head


def diff_empty(diff: str, porcelain: str) -> bool:
    return diff.strip() == "" and porcelain.strip() == ""


def parse_test_output(output: str, exit_code):
    """Return (passed, n_passed, n_failed). Recognises unittest / pytest / tap.

    ``0 test cases actually passing`` never counts as passing (RUNNER_DESIGN
    §12 B2): if we cannot find a positive case count we stay conservative.
    """
    import re
    n_passed = n_failed = None
    if re.search(r"Ran\s+\d+\s+tests?", output):
        m = re.search(r"Ran\s+(\d+)\s+tests?", output)
        if m:
            total = int(m.group(1))
            n_passed = total if "OK" in output else 0
            n_failed = 0 if "OK" in output else total
    else:
        m = re.search(r"(\d+)\s+passed", output)
        if m:
            n_passed = int(m.group(1))
        m = re.search(r"(\d+)\s+failed", output)
        if m:
            n_failed = int(m.group(1))
        m = re.search(r"(\d+)\s+error", output)
        if m:
            n_failed = (n_failed or 0) + int(m.group(1))
        m = re.search(r"#\s*pass\s*(\d+)", output)
        if m:
            n_passed = int(m.group(1))
        m = re.search(r"#\s*fail\s*(\d+)", output)
        if m:
            n_failed = int(m.group(1))
    if exit_code != 0:
        return False, n_passed or 0, (n_failed if n_failed is not None else 1)
    if n_passed is not None:
        passed = n_passed >= 1 and (n_failed or 0) == 0
        return passed, n_passed, n_failed or 0
    # No recognisable count: refuse to declare pass on zero evidence of cases.
    return False, 0, 0


def test_command_allowed(cmd: str):
    if not cmd.strip():
        return True, ""
    stripped = cmd.lstrip()
    if stripped.startswith(("./", "/", "bash ", "sh ", "zsh ", "source ", ". ")):
        return False, ("custom script command not in test allowlist: "
                       + cmd.split()[0][:80])
    return True, ""


def file_hashes(worktree: Path, rel_paths):
    out = {}
    for rel in rel_paths or []:
        p = worktree / str(rel)
        if p.is_file():
            out[str(rel)] = agentdb.sha256_text(p.read_bytes().hex())
        else:
            out[str(rel)] = None
    return out


def changed_paths(porcelain: str):
    paths = []
    for line in porcelain.splitlines():
        if len(line) >= 4:
            paths.append(line[3:].strip().strip('"'))
    return paths


def in_expected_paths(paths, expected):
    if not expected:
        return True, []
    out_of_scope = [p for p in paths
                    if not any(p == e or p.startswith(e.rstrip("/") + "/")
                               for e in expected)]
    return not out_of_scope, out_of_scope


def main(argv):
    parser = argparse.ArgumentParser(description="Phase 1 task runner")
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--worktree", required=True)
    parser.add_argument("--base-commit", required=True)
    parser.add_argument("--agent-cmd", default="")
    parser.add_argument("--test-command", default="")
    parser.add_argument("--claim", default="")          # JSON, agent self-report
    parser.add_argument("--no-tests", action="store_true")
    parser.add_argument("--expected-paths", default="")  # JSON list
    parser.add_argument("--pinned-tests", default="")    # JSON list of rel paths
    parser.add_argument("--deliverable-tests", default="")  # JSON list of rel paths
    parser.add_argument("--mission-id", default="")
    parser.add_argument("--agent-id", default="")
    parser.add_argument("--timeout", type=float, default=120.0)
    args = parser.parse_args(argv)

    state_dir = Path(os.environ.get("BRIDGE_STATE_DIR")
                     or (Path.home() / ".agent-office")).expanduser()
    worktree = Path(args.worktree).expanduser()
    if not worktree.is_dir():
        print("worktree does not exist: %s" % worktree, file=sys.stderr)
        return 2

    claim = {}
    if args.claim.strip():
        try:
            claim = json.loads(args.claim)
        except ValueError as exc:
            print("invalid --claim JSON: %s" % exc, file=sys.stderr)
            return 2
    expected_paths = json.loads(args.expected_paths) if args.expected_paths.strip() else None
    pinned = json.loads(args.pinned_tests) if args.pinned_tests.strip() else []
    deliverable = json.loads(args.deliverable_tests) if args.deliverable_tests.strip() else []

    # Reject a non-allowlisted custom test command *before* running anything,
    # and record a failed run with a readable reason (RUNNER_DESIGN §12 B2).
    allowed, cmd_reason = test_command_allowed(args.test_command)
    if not allowed:
        conn = agentdb.connect(agentdb.default_db_path(state_dir))
        agentdb.init_schema(conn)
        run_id = agentdb.create_run(
            conn, task_id=args.task_id, mission_id=args.mission_id,
            worktree_path=str(worktree), base_commit=args.base_commit,
            agent_id=args.agent_id, test_command=args.test_command)
        agentdb.set_run_status(conn, run_id, "failed",
                               fail_reason="test_not_allowlisted",
                               blocked_note=cmd_reason)
        agentdb.add_event(conn, "run", args.agent_id, "run", run_id,
                          {"fail_reason": "test_not_allowlisted",
                           "note": cmd_reason})
        print(json.dumps({"runId": run_id, "status": "failed",
                          "fail_reason": "test_not_allowlisted",
                          "note": cmd_reason}, ensure_ascii=False))
        return 0

    # Baseline snapshot of the pinned + deliverable test surface (before agent).
    pinned_before = file_hashes(worktree, pinned)
    deliverable_before = file_hashes(worktree, deliverable)

    key = agentdb.load_bridge_key(state_dir)
    token = secrets.token_hex(32)
    thash = agentdb.token_hash(token)

    conn = agentdb.connect(agentdb.default_db_path(state_dir))
    agentdb.init_schema(conn)
    run_id = agentdb.create_run(
        conn, task_id=args.task_id, mission_id=args.mission_id,
        worktree_path=str(worktree), base_commit=args.base_commit,
        agent_id=args.agent_id, test_command=args.test_command, token_hash=thash)
    agentdb.set_run_status(conn, run_id, "running")

    # G1: run the agent in its own process group, token injected.
    timed_out = False
    killed = False
    exit_code = 0
    agent_out = ""
    if args.agent_cmd.strip():
        exit_code, agent_out, timed_out = _shell(
            args.agent_cmd, worktree, args.timeout,
            env={"AGENT_OFFICE_RUN_TOKEN": token})
    if exit_code is None:
        timed_out = True
        exit_code = -1
    elif exit_code < 0:
        killed = True
        sig = signal.Signals(-exit_code).name if -exit_code in \
            {s.value for s in signal.Signals} else str(-exit_code)
        agent_out += ("\n[runner] agent killed by signal %s" % sig)

    # G2: collect diff (incl. untracked).
    diff, porcelain, head = collect_diff(worktree, args.base_commit)
    diff_hash = agentdb.sha256_text(agentdb.canonical(
        {"diff": diff, "porcelain": porcelain}))

    # G3: run the declared test command (bridge-side).
    test_output = ""
    test_output_hash = None
    test_passed = True
    test_n_passed = test_n_failed = 0
    if not args.no_tests and args.test_command.strip():
        tcode, test_output, _ = _shell(args.test_command, worktree, args.timeout)
        test_passed, test_n_passed, test_n_failed = parse_test_output(
            test_output, tcode if tcode is not None else -1)
        test_output_hash = agentdb.sha256_text(test_output)

    claim_hash = agentdb.sha256_text(agentdb.canonical(claim)) if claim else None

    # Pinned test surface tamper check (RUNNER_DESIGN §6).
    pinned_after = file_hashes(worktree, pinned)
    tampered = [p for p in pinned if pinned_before.get(p) != pinned_after.get(p)]
    deliverable_after = file_hashes(worktree, deliverable)
    deliverable_changed = [p for p in deliverable
                           if deliverable_before.get(p) != deliverable_after.get(p)]

    # ------------------------------------------------------------------ gates
    status = None
    fail_reason = None
    review_reason = None
    has_diff = not diff_empty(diff, porcelain)

    if timed_out:
        status, fail_reason = "failed", "timeout"
    elif killed:
        status, fail_reason = "failed", "killed"
    elif exit_code != 0:
        status, fail_reason = "failed", "non_zero_exit"
    elif not has_diff and not claim.get("noChange"):
        status, fail_reason = "failed", "empty_run"
    elif tampered:
        status, review_reason = "waiting_approval", "tampered_test"
    elif not args.no_tests and args.test_command.strip() and not test_passed:
        status, fail_reason = "failed", "test_failed"
    elif not has_diff and claim.get("noChange"):
        status, review_reason = "waiting_approval", "no_change_claim"
    elif expected_paths is not None and not in_expected_paths(
            changed_paths(porcelain), expected_paths)[0]:
        status, review_reason = "waiting_approval", "out_of_scope_diff"
    else:
        status = "waiting_approval"

    # ------------------------------------------------------------------ write
    agentdb.add_run_evidence(conn, run_id, "exit",
                             json.dumps({"exit_code": exit_code,
                                         "timed_out": timed_out,
                                         "killed": killed}))
    agentdb.add_run_evidence(conn, run_id, "diff", diff)
    if args.test_command.strip():
        agentdb.add_run_evidence(conn, run_id, "test_output", test_output)
    if claim:
        agentdb.add_run_evidence(conn, run_id, "claim", agentdb.canonical(claim))
    if deliverable_changed:
        agentdb.add_event(conn, "run", args.agent_id, "run", run_id,
                          {"deliverable_tests_changed": deliverable_changed})
    if tampered:
        agentdb.add_event(conn, "run", args.agent_id, "run", run_id,
                          {"tampered_pinned": tampered})

    prev = agentdb.latest_prev_receipt_hash(conn)
    run = agentdb.get_run(conn, run_id)
    run.update({
        "diff_hash": diff_hash,
        "test_output_hash": test_output_hash,
        "claim_hash": claim_hash,
        "test_command_hash": agentdb.sha256_text(args.test_command) if args.test_command else None,
        "exit_code": exit_code,
        "head_commit": head,
    })
    receipt = agentdb.compute_receipt_hash(key, prev, run)
    agentdb.set_run_status(
        conn, run_id, status,
        exit_code=exit_code, diff_hash=diff_hash, test_output_hash=test_output_hash,
        claim_hash=claim_hash, test_command_hash=run["test_command_hash"],
        receipt_hash=receipt, prev_receipt_hash=prev, head_commit=head,
        fail_reason=fail_reason, review_reason=review_reason)

    agentdb.add_event(conn, "run", args.agent_id, "run", run_id,
                      {"status": status, "fail_reason": fail_reason,
                       "review_reason": review_reason, "receipt_hash": receipt})

    result = {
        "runId": run_id,
        "status": status,
        "exit_code": exit_code,
        "diff_hash": diff_hash,
        "test_output_hash": test_output_hash,
        "claim_hash": claim_hash,
        "receipt_hash": receipt,
        "fail_reason": fail_reason,
        "review_reason": review_reason,
        "has_diff": has_diff,
        "test_passed": test_passed,
        "test_n_passed": test_n_passed,
        "test_n_failed": test_n_failed,
        "tampered_pinned": tampered,
        "deliverable_tests_changed": deliverable_changed,
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
