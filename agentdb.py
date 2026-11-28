#!/usr/bin/env python3
"""Shared SQLite data layer for Phase 1 (runner / bridge / migration).

One schema, three writers:
  - ``runner.py``   writes ``runs`` / ``run_evidence`` / ``run_tokens`` / ``events``.
  - ``bridge.py``   ``submit_evidence`` validates run tokens and records claims.
  - ``migration.py`` moves the legacy ``missions.json`` into the same file.

Schema mirrors ``docs/RUNNER_DATA_MODEL.md``. The legacy JSON entities are kept
lossless via a ``data`` JSON column (camelCase preserved) beside the typed
columns the runner/approval path actually filters on.
"""
from __future__ import annotations

import datetime
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from pathlib import Path

SCHEMA_VERSION = 2

GENESIS = hashlib.sha256(b"agent-office.runs.genesis.v1").hexdigest()
SIGNING_PREFIX = b"agent-office.runs.v1:"


def now_iso() -> str:
    return (datetime.datetime.now(datetime.timezone.utc)
            .replace(microsecond=0).isoformat().replace("+00:00", "Z"))


def sha256_text(value) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


def canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"))


def default_db_path(state_dir) -> Path:
    return Path(state_dir) / "agent-office.db"


def connect(db_path, timeout: float = 5.0) -> sqlite3.Connection:
    """Open a connection with the Phase-1 pragmas.

    Connections are created per-thread and never shared across threads
    (sqlite3 connections are not thread-safe). See RUNNER_DESIGN §7.
    """
    conn = sqlite3.connect(str(db_path), timeout=timeout)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=FULL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value JSON NOT NULL
);

-- Legacy entity: missions (lossless JSON + typed filter columns)
CREATE TABLE IF NOT EXISTS missions (
    id          TEXT PRIMARY KEY,
    status      TEXT,
    priority    TEXT,
    deadline    TEXT,
    created_at  TEXT,
    updated_at  TEXT,
    data        JSON NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id                 TEXT PRIMARY KEY,
    mission_id         TEXT,
    key                TEXT,
    title              TEXT,
    status             TEXT,
    assignee_id        TEXT,
    assignee_name      TEXT,
    priority           TEXT,
    created_at         TEXT,
    updated_at         TEXT,
    expected_paths     JSON,
    pinned_tests       JSON,
    deliverable_tests  JSON,
    test_command       TEXT,
    test_command_hash  TEXT,
    no_tests           INTEGER DEFAULT 0,
    base_commit        TEXT,
    merge_target       TEXT,
    data               JSON NOT NULL,
    FOREIGN KEY (mission_id) REFERENCES missions(id)
);

CREATE TABLE IF NOT EXISTS approvals (
    id                 TEXT PRIMARY KEY,
    mission_id         TEXT,
    task_id            TEXT,
    status             TEXT,
    created_at         TEXT,
    resolved_at        TEXT,
    run_id             TEXT,
    base_commit        TEXT,
    merge_target       TEXT,
    diff_hash          TEXT,
    test_output_hash   TEXT,
    claim_hash         TEXT,
    test_command_hash  TEXT,
    data               JSON NOT NULL,
    FOREIGN KEY (mission_id) REFERENCES missions(id),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS conversations (
    id         TEXT PRIMARY KEY,
    mission_id TEXT,
    created_at TEXT,
    updated_at TEXT,
    data       JSON NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id            TEXT PRIMARY KEY,
    conversation_id TEXT,
    created_at    TEXT,
    data          JSON NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
    id         TEXT PRIMARY KEY,
    mission_id TEXT,
    task_id    TEXT,
    created_at TEXT,
    data       JSON NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
    id         TEXT PRIMARY KEY,
    created_at TEXT,
    data       JSON NOT NULL
);

CREATE TABLE IF NOT EXISTS model_calls (
    id         TEXT PRIMARY KEY,
    created_at TEXT,
    data       JSON NOT NULL
);

-- Phase 1: run lifecycle (RUNNER_DATA_MODEL §2.2)
CREATE TABLE IF NOT EXISTS runs (
    id                 TEXT PRIMARY KEY,
    task_id            TEXT,
    mission_id         TEXT,
    status             TEXT NOT NULL,
    worktree_path      TEXT,
    base_commit        TEXT,
    head_commit        TEXT,
    merge_target       TEXT,
    exit_code          INTEGER,
    diff_hash          TEXT,
    test_output_hash   TEXT,
    claim_hash         TEXT,
    test_command_hash  TEXT,
    receipt_hash       TEXT,
    prev_receipt_hash  TEXT,
    session_pgid       INTEGER,
    token_hash         TEXT,
    frozen             INTEGER DEFAULT 0,
    review_reason      TEXT,
    fail_reason        TEXT,
    blocked_note       TEXT,
    heartbeat_at       TEXT,
    started_at         TEXT,
    ended_at           TEXT,
    merged_at          TEXT,
    post_merge_defects INTEGER DEFAULT 0,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS run_evidence (
    id            TEXT PRIMARY KEY,
    run_id        TEXT NOT NULL,
    kind          TEXT NOT NULL,          -- diff / test_output / exit / claim
    content_hash  TEXT,
    content       TEXT,
    binary        INTEGER DEFAULT 0,
    collected_by  TEXT NOT NULL DEFAULT 'bridge',
    created_at    TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS run_tokens (
    run_id     TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    agent_id   TEXT,
    created_at TEXT,
    expires_at TEXT,
    FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS events (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL,          -- read/write/git/evidence/run/approval/heartbeat/restart/kill
    agent_id      TEXT,
    resource_type TEXT,
    resource_id   TEXT,
    payload       JSON,
    created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_mission   ON tasks(mission_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee  ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_runs_task       ON runs(task_id);
CREATE INDEX IF NOT EXISTS idx_runs_status     ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_receipt    ON runs(receipt_hash);
CREATE INDEX IF NOT EXISTS idx_runs_heartbeat  ON runs(heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_events_resource ON events(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_events_agent    ON events(agent_id);
"""


def _ensure_column(conn, table, column, ddl):
    """Add a column if missing (idempotent), so pre-existing DBs created before
    this column was introduced still open cleanly (no ALTER migration infra)."""
    cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(_SCHEMA_SQL)
    # Phase 1 adds these columns after the first release cut; older DBs may not
    # have them, so add idempotently instead of requiring a destructive rebuild.
    _ensure_column(conn, "runs", "merged_at", "merged_at TEXT")
    _ensure_column(conn, "runs", "post_merge_defects",
                   "post_merge_defects INTEGER DEFAULT 0")
    conn.execute(
        "INSERT OR IGNORE INTO meta(key, value) VALUES('schema_version', ?)",
        (json.dumps(SCHEMA_VERSION),),
    )
    conn.execute(
        "INSERT OR IGNORE INTO meta(key, value) VALUES('source_of_truth', 'sqlite')",
    )
    conn.commit()


# --------------------------------------------------------------------------- #
# ids
# --------------------------------------------------------------------------- #

def new_id(prefix: str) -> str:
    return prefix + "-" + secrets.token_hex(8)


def run_id_for(task_id: str) -> str:
    return "run-" + secrets.token_hex(8)


# --------------------------------------------------------------------------- #
# runs
# --------------------------------------------------------------------------- #

def create_run(conn, *, task_id, mission_id="", worktree_path="",
               base_commit="", merge_target="", agent_id="",
               test_command="", token_hash=""):
    run_id = run_id_for(task_id)
    now = now_iso()
    # A run belongs to a task/mission; when the runner is invoked standalone
    # (no bridge has pre-created them), create minimal parent rows so the FK
    # constraints hold. In production the bridge creates these first.
    if mission_id:
        conn.execute(
            "INSERT OR IGNORE INTO missions(id, status, data) VALUES (?,?,?)",
            (mission_id, "active", "{}"),
        )
    conn.execute(
        "INSERT OR IGNORE INTO tasks(id, mission_id, status, no_tests, data) "
        "VALUES (?,?,?,?,?)",
        (task_id, mission_id or None, "in_progress", 0, "{}"),
    )
    conn.execute(
        """INSERT INTO runs
           (id, task_id, mission_id, status, worktree_path, base_commit,
            merge_target, token_hash, test_command_hash, heartbeat_at, started_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (run_id, task_id, mission_id, "queued", worktree_path, base_commit,
         merge_target, token_hash, sha256_text(test_command) if test_command else None,
         now, now),
    )
    conn.execute(
        "INSERT INTO run_tokens(run_id, token_hash, agent_id, created_at) "
        "VALUES (?,?,?,?)",
        (run_id, token_hash, agent_id, now),
    )
    add_event(conn, "run", agent_id, "run", run_id, {"status": "queued"})
    conn.commit()
    return run_id


def set_run_status(conn, run_id, status, **fields):
    """Transition a run; unknown/illegal columns are ignored by SQLite."""
    allowed = {
        "exit_code", "diff_hash", "test_output_hash", "claim_hash",
        "test_command_hash", "receipt_hash", "prev_receipt_hash",
        "session_pgid", "frozen", "review_reason", "fail_reason",
        "blocked_note", "head_commit", "ended_at", "merged_at",
        "post_merge_defects", "heartbeat_at",
    }
    updates = {"status": status}
    for key, value in fields.items():
        if key in allowed:
            updates[key] = value
    updates["heartbeat_at"] = now_iso()
    if status in ("done", "failed") and "ended_at" not in updates:
        updates["ended_at"] = now_iso()
    cols = ", ".join(f"{k}=?" for k in updates)
    conn.execute(
        f"UPDATE runs SET {cols} WHERE id=?",
        (*updates.values(), run_id),
    )
    conn.commit()


def heartbeat(conn, run_id):
    conn.execute("UPDATE runs SET heartbeat_at=? WHERE id=?", (now_iso(), run_id))
    conn.commit()


def get_run(conn, run_id) -> dict | None:
    row = conn.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
    return dict(row) if row else None


def latest_prev_receipt_hash(conn):
    row = conn.execute(
        "SELECT receipt_hash FROM runs WHERE receipt_hash IS NOT NULL "
        "ORDER BY started_at DESC, id DESC LIMIT 1").fetchone()
    return row["receipt_hash"] if row else GENESIS


def _parse_iso(ts):
    """Parse ``now_iso()`` timestamps into aware datetimes (None on bad input)."""
    if not ts:
        return None
    try:
        return datetime.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None


def run_metrics(conn, run_id):
    """The two validation metrics from RUNNER_DESIGN §10.

    Returns ``time_to_trusted_merge_sec`` (started_at → merged_at) and
    ``post_merge_defects``, or ``None`` when the run does not exist. The
    approval + evidence-collection overhead is kept separate by reading the
    ``approvals`` table, not folded into the merge clock.
    """
    row = conn.execute(
        "SELECT started_at, merged_at, post_merge_defects FROM runs WHERE id=?",
        (run_id,),
    ).fetchone()
    if not row:
        return None
    started, merged = _parse_iso(row["started_at"]), _parse_iso(row["merged_at"])
    ttm = (merged - started).total_seconds() if (started and merged) else None
    return {
        "run_id": run_id,
        "started_at": row["started_at"],
        "merged_at": row["merged_at"],
        "time_to_trusted_merge_sec": ttm,
        "post_merge_defects": row["post_merge_defects"] or 0,
    }


# --------------------------------------------------------------------------- #
# run tokens
# --------------------------------------------------------------------------- #

def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_run_token(conn, run_id, agent_id=""):
    """Create a run-scoped token and return (plaintext, hash)."""
    token = secrets.token_hex(32)
    thash = token_hash(token)
    conn.execute(
        "UPDATE run_tokens SET token_hash=?, agent_id=?, created_at=? WHERE run_id=?",
        (thash, agent_id, now_iso(), run_id),
    )
    conn.execute("UPDATE runs SET token_hash=? WHERE id=?", (thash, run_id))
    conn.commit()
    return token, thash


def verify_run_token(conn, token, run_id, agent_id=""):
    """Validate the token -> runId -> agentId triple (RUNNER_DESIGN §2 B8)."""
    if not token or not run_id:
        return False, "missing run token or runId"
    row = conn.execute(
        "SELECT token_hash, agent_id FROM run_tokens WHERE run_id=?", (run_id,)
    ).fetchone()
    if not row:
        return False, "unknown runId"
    if not hmac.compare_digest(str(row["token_hash"] or ""), token_hash(token)):
        return False, "run token mismatch"
    if agent_id and row["agent_id"] and str(row["agent_id"]) != str(agent_id):
        return False, "agent mismatch"
    return True, ""


# --------------------------------------------------------------------------- #
# run evidence
# --------------------------------------------------------------------------- #

def add_run_evidence(conn, run_id, kind, content="", binary=False, collected_by="bridge"):
    if isinstance(content, bytes):
        binary = True
        digest = hashlib.sha256(content).hexdigest()
        store = None  # binary: store hash only, mark binary (RUNNER_DESIGN §11 C2)
    else:
        text = str(content or "")
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        store = text
    ev_id = new_id("rev")
    conn.execute(
        """INSERT INTO run_evidence
           (id, run_id, kind, content_hash, content, binary, collected_by, created_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (ev_id, run_id, kind, digest, store, 1 if binary else 0,
         collected_by, now_iso()),
    )
    conn.commit()
    return ev_id, digest


def get_claim(conn, run_id):
    row = conn.execute(
        "SELECT content, content_hash FROM run_evidence "
        "WHERE run_id=? AND kind='claim' ORDER BY created_at DESC LIMIT 1",
        (run_id,),
    ).fetchone()
    return dict(row) if row else None


# --------------------------------------------------------------------------- #
# events
# --------------------------------------------------------------------------- #

def add_event(conn, type_, agent_id="", resource_type="", resource_id="",
              payload=None):
    conn.execute(
        """INSERT INTO events
           (id, type, agent_id, resource_type, resource_id, payload, created_at)
           VALUES (?,?,?,?,?,?,?)""",
        (new_id("evt"), type_, agent_id, resource_type, resource_id,
         json.dumps(payload or {}, ensure_ascii=False), now_iso()),
    )
    conn.commit()


# --------------------------------------------------------------------------- #
# tasks / orchestration (expected-path conflict, RUNNER_DESIGN §4)
# --------------------------------------------------------------------------- #

def set_task_expected_paths(conn, task_id, expected_paths):
    """Persist a task's expectedPaths so later runs can detect overlap."""
    conn.execute(
        "UPDATE tasks SET expected_paths=? WHERE id=?",
        (json.dumps(list(expected_paths or [])), task_id),
    )
    conn.commit()


def conflicting_in_flight_run(conn, expected_paths, exclude_task_id):
    """Return (run_id, overlap) when another *in-flight* run's task overlaps
    this task's expectedPaths, else None.

    In-flight = queued / running / waiting_approval (not yet merged to done).
    Overlap is a path-prefix match: ``src/a`` and ``src/a/b`` collide.
    """
    if not expected_paths:
        return None
    rows = conn.execute(
        "SELECT r.id, r.task_id, t.expected_paths FROM runs r "
        "LEFT JOIN tasks t ON t.id = r.task_id "
        "WHERE r.status IN ('queued','running','waiting_approval') "
        "AND r.task_id != ?", (exclude_task_id,),
    ).fetchall()
    mine = [p.rstrip("/") for p in expected_paths]
    for row in rows:
        try:
            other = json.loads(row["expected_paths"] or "[]")
        except ValueError:
            other = []
        other = [p.rstrip("/") for p in other if isinstance(p, str)]
        overlap = sorted({a for a in mine for b in other
                          if a == b or a.startswith(b + "/") or b.startswith(a + "/")})
        if overlap:
            return row["id"], overlap
    return None


# --------------------------------------------------------------------------- #
# approvals (RUNNER_DESIGN §8)
# --------------------------------------------------------------------------- #

def add_approval(conn, *, run_id, mission_id="", task_id="", status="approved",
                 base_commit="", merge_target="", diff_hash="",
                 test_output_hash="", claim_hash="", test_command_hash="",
                 payload=None):
    ap_id = new_id("apv")
    now = now_iso()
    # mission_id / task_id are nullable FKs; an empty string is not a valid
    # reference, so normalise to NULL (the runner may run standalone without a
    # mission and never create a parent missions row).
    mission_id = mission_id or None
    task_id = task_id or None
    data = dict(payload or {})
    data.setdefault("runId", run_id)
    data.setdefault("status", status)
    conn.execute(
        """INSERT INTO approvals
           (id, mission_id, task_id, status, created_at, resolved_at, run_id,
            base_commit, merge_target, diff_hash, test_output_hash, claim_hash,
            test_command_hash, data)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (ap_id, mission_id, task_id, status, now, now, run_id, base_commit,
         merge_target, diff_hash, test_output_hash, claim_hash,
         test_command_hash, json.dumps(data, ensure_ascii=False)),
    )
    conn.commit()
    return ap_id


def mark_orphaned_runs(conn, stale_before_iso):
    """Fail any run still queued/running with a stale heartbeat (RUNNER_DESIGN
    §9 A3): the runner process died, so the run must not linger forever.

    Returns the number of runs transitioned to failed(orphaned)."""
    rows = conn.execute(
        "SELECT r.id, r.task_id, COALESCE(rt.agent_id, '') AS agent_id "
        "FROM runs r LEFT JOIN run_tokens rt ON rt.run_id = r.id "
        "WHERE r.status IN ('queued','running') AND r.heartbeat_at < ?",
        (stale_before_iso,),
    ).fetchall()
    n = 0
    for row in rows:
        set_run_status(conn, row["id"], "failed", fail_reason="orphaned",
                       blocked_note="bridge restart: no live runner heartbeat")
        add_event(conn, "run", row["agent_id"], "run", row["id"],
                  {"status": "failed", "fail_reason": "orphaned"})
        n += 1
    return n


# --------------------------------------------------------------------------- #
# receipt hash chain (RUNNER_DATA_MODEL §4)
# --------------------------------------------------------------------------- #

def compute_receipt_hash(key: bytes, prev_hash: str, run: dict) -> str:
    body = canonical({
        "runId": run["id"],
        "diffHash": run.get("diff_hash"),
        "testOutputHash": run.get("test_output_hash"),
        "claimHash": run.get("claim_hash"),
        "testCommandHash": run.get("test_command_hash"),
        "exitCode": run.get("exit_code"),
        "baseCommit": run.get("base_commit"),
    })
    return hmac.new(key, SIGNING_PREFIX + prev_hash.encode("utf-8")
                    + b":" + body.encode("utf-8"), hashlib.sha256).hexdigest()


def load_bridge_key(state_dir) -> bytes:
    """The run-receipt key lives beside the existing evidence key.

    Reuse evidence.py's key file when present so receipts stay in one key
    domain; otherwise create our own 32-byte key in the state directory.
    """
    key_path = Path(state_dir) / "evidence.key"
    if key_path.exists():
        try:
            raw = key_path.read_text("utf-8").strip()
            key = bytes.fromhex(raw)
            if len(key) == 32:
                return key
        except (OSError, ValueError):
            pass
    key = secrets.token_bytes(32)
    tmp = key_path.with_name(key_path.name + ".tmp-" + secrets.token_hex(4))
    try:
        Path(state_dir).mkdir(parents=True, exist_ok=True)
        tmp.write_text(key.hex(), encoding="utf-8")
        os.chmod(tmp, 0o600)
        os.replace(tmp, key_path)
    except OSError:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise
    return key
