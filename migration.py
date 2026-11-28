#!/usr/bin/env python3
"""Phase 1 JSON -> SQLite migration (RUNNER_DESIGN §7 / RUNNER_DATA_MODEL §1).

Moves the legacy ``missions.json`` (a single dict of camelCase entity lists) into
``agent-office.db`` (the shared schema in ``agentdb.py``), with the guarantees the
design asks for:

- **maintenance mode** — ``meta.maintenance`` is set for the whole migration so a
  running bridge can refuse new writes to the JSON source (source is read-only
  for the entire system, not just this process).
- **idempotent / re-entrant** — every entity is keyed by its stable ``id`` and
  written with ``INSERT OR REPLACE`` (leaves) or an in-place ``UPSERT`` (parents
  that own child FKs), so re-running converges to the same database and a
  SIGKILL mid-run is simply resumed on the next run.
- **cutover** — a single ``meta.source_of_truth`` pointer flips from ``json`` to
  ``sqlite`` only after the import and a row-count sanity check pass.
- **rollback** — reconstructs the JSON source from SQLite (so post-cutover writes
  are not lost), flips the pointer back, and archives the old JSON instead of
  deleting it.

Usage::

    python3 migration.py --state-dir <dir> migrate [--source missions.json]
    python3 migration.py --state-dir <dir> rollback [--source missions.json]
    python3 migration.py --state-dir <dir> status

``BRIDGE_STATE_DIR`` is honoured when ``--state-dir`` is omitted, matching the
runner / bridge. Only the standard library is used.
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import sqlite3
import sys
import time
from pathlib import Path

# Test hook: sleep this many milliseconds between entities so a kill-safety
# exercise (SIGKILL mid-migration) can reliably land inside the import loop.
# 0 in production; the eval harness sets it via env.
def _migration_delay_ms() -> int:
    try:
        return max(0, int(os.environ.get("AGENT_OFFICE_MIGRATION_DELAY_MS") or 0))
    except ValueError:
        return 0

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import agentdb  # noqa: E402


def _canonical(value) -> str:
    return agentdb.canonical(value)


def _text(value) -> str:
    return "" if value is None else str(value)


def _int(value, default=0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _json_or_none(value) -> str | None:
    if value is None:
        return None
    return agentdb.canonical(value)


def load_source(json_path: Path) -> dict:
    raw = json_path.read_text("utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("missions.json must contain a JSON object")
    data.setdefault("missions", [])
    data.setdefault("conversations", [])
    data.setdefault("messages", [])
    data.setdefault("approvals", [])
    data.setdefault("artifacts", [])
    data.setdefault("memories", [])
    data.setdefault("modelCalls", [])
    data.setdefault("next", {"message": 1})
    return data


# --------------------------------------------------------------------------- #
# import
# --------------------------------------------------------------------------- #

def _import_mission(conn, m: dict) -> None:
    mission_id = _text(m.get("id")) or ("msn-" + secrets.token_hex(6))
    conn.execute(
        """INSERT INTO missions
           (id, status, priority, deadline, created_at, updated_at, data)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             status=excluded.status, priority=excluded.priority,
             deadline=excluded.deadline, created_at=excluded.created_at,
             updated_at=excluded.updated_at, data=excluded.data""",
        (mission_id, _text(m.get("status")), _text(m.get("priority")),
         _text(m.get("deadline")), _text(m.get("createdAt")),
         _text(m.get("updatedAt")), _canonical(m)),
    )
    for t in (m.get("tasks") or []):
        if not isinstance(t, dict):
            continue
        task_id = _text(t.get("id")) or ("tsk-" + secrets.token_hex(6))
        conn.execute(
            """INSERT INTO tasks
               (id, mission_id, key, title, status, assignee_id, assignee_name,
                priority, created_at, updated_at, expected_paths, pinned_tests,
                deliverable_tests, test_command, test_command_hash, no_tests,
                base_commit, merge_target, data)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 mission_id=excluded.mission_id, key=excluded.key,
                 title=excluded.title, status=excluded.status,
                 assignee_id=excluded.assignee_id,
                 assignee_name=excluded.assignee_name,
                 priority=excluded.priority, created_at=excluded.created_at,
                 updated_at=excluded.updated_at,
                 expected_paths=excluded.expected_paths,
                 pinned_tests=excluded.pinned_tests,
                 deliverable_tests=excluded.deliverable_tests,
                 test_command=excluded.test_command,
                 test_command_hash=excluded.test_command_hash,
                 no_tests=excluded.no_tests, base_commit=excluded.base_commit,
                 merge_target=excluded.merge_target, data=excluded.data""",
            (task_id, mission_id, _text(t.get("key")), _text(t.get("title")),
             _text(t.get("status")), _text(t.get("assigneeId")),
             _text(t.get("assigneeName")), _text(t.get("priority")),
             _text(t.get("createdAt")), _text(t.get("updatedAt")),
             _json_or_none(t.get("expectedPaths")),
             _json_or_none(t.get("pinnedTests")),
             _json_or_none(t.get("deliverableTests")),
             _text(t.get("testCommand")), _text(t.get("testCommandHash")),
             _int(t.get("noTests")), _text(t.get("baseCommit")),
             _text(t.get("mergeTarget")), _canonical(t)),
        )


def _import_conversation(conn, c: dict) -> None:
    conn.execute(
        """INSERT OR REPLACE INTO conversations
           (id, mission_id, created_at, updated_at, data)
           VALUES (?,?,?,?,?)""",
        (_text(c.get("id")), _text(c.get("missionId")),
         _text(c.get("createdAt")), _text(c.get("updatedAt")), _canonical(c)),
    )


def _import_message(conn, m: dict) -> None:
    conn.execute(
        """INSERT OR REPLACE INTO messages
           (id, conversation_id, created_at, data)
           VALUES (?,?,?,?)""",
        (_text(m.get("id")), _text(m.get("conversationId")),
         _text(m.get("createdAt")), _canonical(m)),
    )


def _import_approval(conn, a: dict) -> None:
    conn.execute(
        """INSERT OR REPLACE INTO approvals
           (id, mission_id, task_id, status, created_at, resolved_at, run_id,
            base_commit, merge_target, diff_hash, test_output_hash, claim_hash,
            test_command_hash, data)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (_text(a.get("id")), _text(a.get("missionId")), _text(a.get("taskId")),
         _text(a.get("status")), _text(a.get("createdAt")),
         _text(a.get("resolvedAt")), _text(a.get("runId")),
         _text(a.get("baseCommit")), _text(a.get("mergeTarget")),
         _text(a.get("diffHash")), _text(a.get("testOutputHash")),
         _text(a.get("claimHash")), _text(a.get("testCommandHash")),
         _canonical(a)),
    )


def _import_artifact(conn, a: dict) -> None:
    conn.execute(
        """INSERT OR REPLACE INTO artifacts
           (id, mission_id, task_id, created_at, data)
           VALUES (?,?,?,?,?)""",
        (_text(a.get("id")), _text(a.get("missionId")), _text(a.get("taskId")),
         _text(a.get("createdAt")), _canonical(a)),
    )


def _import_memory(conn, m: dict) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO memories (id, created_at, data) VALUES (?,?,?)",
        (_text(m.get("id")), _text(m.get("createdAt")), _canonical(m)),
    )


def _import_model_call(conn, c: dict) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO model_calls (id, created_at, data) VALUES (?,?,?)",
        (_text(c.get("id")), _text(c.get("createdAt")), _canonical(c)),
    )


def import_all(conn: sqlite3.Connection, data: dict) -> dict:
    """Import the full JSON payload. Each entity is its own transaction so a
    SIGKILL between entities rolls back cleanly and the next run resumes."""
    counts = {"missions": 0, "tasks": 0, "conversations": 0, "messages": 0,
              "approvals": 0, "artifacts": 0, "memories": 0, "model_calls": 0}
    delay = _migration_delay_ms() / 1000.0
    # Parents first (missions -> their nested tasks) to satisfy FKs.
    for m in data.get("missions", []):
        if not isinstance(m, dict):
            continue
        with conn:
            _import_mission(conn, m)
        counts["missions"] += 1
        counts["tasks"] += len([t for t in (m.get("tasks") or [])
                                if isinstance(t, dict)])
        if delay:
            time.sleep(delay)
    for c in data.get("conversations", []):
        if isinstance(c, dict):
            with conn:
                _import_conversation(conn, c)
            counts["conversations"] += 1
    for m in data.get("messages", []):
        if isinstance(m, dict):
            with conn:
                _import_message(conn, m)
            counts["messages"] += 1
    for a in data.get("approvals", []):
        if isinstance(a, dict):
            with conn:
                _import_approval(conn, a)
            counts["approvals"] += 1
    for a in data.get("artifacts", []):
        if isinstance(a, dict):
            with conn:
                _import_artifact(conn, a)
            counts["artifacts"] += 1
    for m in data.get("memories", []):
        if isinstance(m, dict):
            with conn:
                _import_memory(conn, m)
            counts["memories"] += 1
    for c in data.get("modelCalls", []):
        if isinstance(c, dict):
            with conn:
                _import_model_call(conn, c)
            counts["model_calls"] += 1
    with conn:
        conn.execute(
            "INSERT INTO meta(key, value) VALUES('next', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (_canonical(data.get("next", {"message": 1})),),
        )
    return counts


def _row_counts(conn: sqlite3.Connection) -> dict:
    out = {}
    for table in ("missions", "tasks", "conversations", "messages",
                  "approvals", "artifacts", "memories", "model_calls"):
        out[table] = conn.execute(
            f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    return out


def set_meta(conn: sqlite3.Connection, key: str, value) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, json.dumps(value, ensure_ascii=False)),
    )
    conn.commit()


def migrate(state_dir: Path, source: Path) -> dict:
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not source.exists():
        raise FileNotFoundError("missions.json not found: %s" % source)
    data = load_source(source)
    db_path = agentdb.default_db_path(state_dir)
    conn = agentdb.connect(db_path)
    agentdb.init_schema(conn)

    # Maintenance mode on for the whole import (source read-only system-wide).
    set_meta(conn, "maintenance", 1)

    counts = import_all(conn, data)
    actual = _row_counts(conn)

    # Sanity check before cutover: every source entity landed in SQLite.
    expected = {
        "missions": len([m for m in data.get("missions", []) if isinstance(m, dict)]),
        "tasks": sum(len([t for t in (m.get("tasks") or []) if isinstance(t, dict)])
                     for m in data.get("missions", []) if isinstance(m, dict)),
        "conversations": len([c for c in data.get("conversations", []) if isinstance(c, dict)]),
        "messages": len([m for m in data.get("messages", []) if isinstance(m, dict)]),
        "approvals": len([a for a in data.get("approvals", []) if isinstance(a, dict)]),
        "artifacts": len([a for a in data.get("artifacts", []) if isinstance(a, dict)]),
        "memories": len([m for m in data.get("memories", []) if isinstance(m, dict)]),
        "model_calls": len([c for c in data.get("modelCalls", []) if isinstance(c, dict)]),
    }
    mismatch = {k: (expected[k], actual.get(k, 0))
                for k in expected if expected[k] != actual.get(k, 0)}
    if mismatch:
        set_meta(conn, "maintenance", 0)
        raise RuntimeError("migration incomplete, refusing cutover: %s" % mismatch)

    # Cutover + clear maintenance.
    set_meta(conn, "source_of_truth", "sqlite")
    set_meta(conn, "maintenance", 0)
    conn.close()
    return {"source_of_truth": "sqlite", "counts": actual}


# --------------------------------------------------------------------------- #
# rollback
# --------------------------------------------------------------------------- #

def _rebuild_json(conn: sqlite3.Connection) -> dict:
    def load_rows(table):
        return [json.loads(r["data"]) for r in
                conn.execute(f"SELECT data FROM {table} ORDER BY id").fetchall()]

    data = {
        "version": 1,
        "missions": [],
        "conversations": load_rows("conversations"),
        "messages": load_rows("messages"),
        "approvals": load_rows("approvals"),
        "artifacts": load_rows("artifacts"),
        "memories": load_rows("memories"),
        "modelCalls": load_rows("model_calls"),
        "next": {"message": 1},
    }
    next_row = conn.execute(
        "SELECT value FROM meta WHERE key='next'").fetchone()
    if next_row:
        data["next"] = json.loads(next_row["value"])
    for mrow in conn.execute("SELECT data FROM missions ORDER BY id").fetchall():
        mission = json.loads(mrow["data"])
        mission["tasks"] = [
            json.loads(trow["data"])
            for trow in conn.execute(
                "SELECT data FROM tasks WHERE mission_id=? ORDER BY id",
                (mission.get("id"),),
            ).fetchall()
        ]
        data["missions"].append(mission)
    return data


def rollback(state_dir: Path, source: Path) -> dict:
    db_path = agentdb.default_db_path(state_dir)
    if not db_path.exists():
        raise FileNotFoundError("no SQLite database to roll back from: %s" % db_path)
    conn = agentdb.connect(db_path)
    agentdb.init_schema(conn)
    rebuilt = _rebuild_json(conn)

    # Archive the old JSON rather than deleting it.
    if source.exists():
        stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime())
        archive = source.with_name(source.name + ".pre-rollback-" + stamp)
        os.replace(source, archive)

    source.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = source.with_name(source.name + ".tmp")
    tmp.write_text(json.dumps(rebuilt, ensure_ascii=False, indent=2), "utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(source)

    set_meta(conn, "source_of_truth", "json")
    set_meta(conn, "maintenance", 0)
    conn.close()
    return {"source_of_truth": "json", "counts": _row_counts(
        agentdb.connect(db_path))}


# --------------------------------------------------------------------------- #
# cli
# --------------------------------------------------------------------------- #

def _parse(argv):
    parser = argparse.ArgumentParser(description="Phase 1 JSON->SQLite migration")
    parser.add_argument("--state-dir", default="",
                        help="state directory (default: $BRIDGE_STATE_DIR or ~/.agent-office)")
    parser.add_argument("--source", default="",
                        help="missions.json path (default: <state-dir>/missions.json)")
    parser.add_argument("command", choices=["migrate", "rollback", "status"],
                        help="operation to perform")
    return parser.parse_args(argv)


def main(argv):
    args = _parse(argv)
    state_dir = Path(args.state_dir or os.environ.get("BRIDGE_STATE_DIR")
                     or (Path.home() / ".agent-office")).expanduser()
    source = Path(args.source or (state_dir / "missions.json")).expanduser()

    if args.command == "status":
        db_path = agentdb.default_db_path(state_dir)
        if not db_path.exists():
            print(json.dumps({"source_of_truth": "json", "migrated": False}))
            return 0
        conn = agentdb.connect(db_path)
        agentdb.init_schema(conn)
        row = conn.execute(
            "SELECT value FROM meta WHERE key='source_of_truth'").fetchone()
        sot = json.loads(row["value"]) if row else "json"
        conn.close()
        print(json.dumps({"source_of_truth": sot, "migrated": sot == "sqlite"}))
        return 0

    if args.command == "migrate":
        result = migrate(state_dir, source)
    else:
        result = rollback(state_dir, source)

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
