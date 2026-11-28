#!/usr/bin/env python3
"""Print the §10 validation metrics for every merged run (RUNNER_VALIDATION.md).

Reads ``BRIDGE_STATE_DIR/agent-office.db`` and reports ``time-to-trusted-merge``
(seconds) + ``post-merge 缺陷数`` per ``done`` run, then a summary line. The
approval/evidence overhead is intentionally kept out of the merge clock (it is
reported separately from the ``approvals`` table).

Usage::

    BRIDGE_STATE_DIR=~/.agent-office python3 scripts/validation_metrics.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import agentdb  # noqa: E402


def main() -> int:
    state_dir = Path(os.environ.get("BRIDGE_STATE_DIR")
                     or (Path.home() / ".agent-office")).expanduser()
    db_path = agentdb.default_db_path(state_dir)
    if not db_path.exists():
        print(f"no run database: {db_path}", file=sys.stderr)
        return 1

    conn = agentdb.connect(db_path)
    try:
        rows = conn.execute(
            "SELECT id FROM runs WHERE status='done' ORDER BY merged_at").fetchall()
        if not rows:
            print("no merged (done) runs yet")
            return 0
        total_ttm = 0.0
        n_ttm = 0
        total_defects = 0
        print(f"{'run_id':24s} {'started_at':20s} {'merged_at':20s} "
              f"{'ttm_sec':>9s} {'defects':>7s}")
        for row in rows:
            m = agentdb.run_metrics(conn, row["id"]) or {}
            ttm = m.get("time_to_trusted_merge_sec")
            defects = m.get("post_merge_defects") or 0
            print(f"{row['id']:24s} {m.get('started_at') or '':20s} "
                  f"{m.get('merged_at') or '':20s} "
                  f"{(f'{ttm:.1f}' if ttm is not None else 'n/a'):>9s} {defects:>7d}")
            if ttm is not None:
                total_ttm += ttm
                n_ttm += 1
            total_defects += defects

        # Approval / evidence overhead, kept separate (not folded into TTM).
        ap_rows = conn.execute(
            "SELECT created_at, resolved_at FROM approvals").fetchall()
        ap_sec = 0.0
        for r in ap_rows:
            a, b = agentdb._parse_iso(r["created_at"]), agentdb._parse_iso(r["resolved_at"])
            if a and b:
                ap_sec += (b - a).total_seconds()

        print("-" * 88)
        print(f"merged runs            : {len(rows)}")
        print(f"mean time-to-trust-merge: "
              f"{(total_ttm / n_ttm if n_ttm else 0):.1f}s (n={n_ttm})")
        print(f"post-merge defects     : {total_defects}")
        print(f"approval overhead      : {ap_sec:.1f}s (approvals={len(ap_rows)})")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
