# Delivery verification and evidence receipts

> Version 1.27.0 · Updated 2026-11-28

Agent Office now separates a **model claim** from **delivery evidence**. A task
can still be produced by a model, but the UI shows whether its files passed a
local, deterministic check.

## Statuses

| Status | Meaning |
| --- | --- |
| `passed` | At least one syntax check ran and passed; no file failed. Project tests are **not** automatically executed. The UI says so. |
| `failed` | A file is missing/empty, a placeholder was detected, or JSON/Python/JavaScript/Shell/HTML/CSS syntax failed. Auto-run does **not** mark this task done. |
| `unverified` | Files exist, but only presence could be checked (documents, missing runtime) or no executable check was available. The task is labeled unverified, not “done with proof”. |

Every report contains the checked files, SHA-256 hashes, file sizes, checks and
timestamps. The verification is local evidence, not a model self-report.

## What is checked

- file exists, is non-empty and is readable;
- placeholder phrases such as “已完成任务并提交交付物” are rejected;
- JSON parses;
- Python compiles in-process (`compile`, no execution);
- JavaScript syntax via `node --check` when Node exists, otherwise macOS
  JavaScriptCore through `osascript` (compiles with `new Function`, no execution);
- Shell syntax via `bash -n`;
- HTML structure via the standard library HTML parser;
- CSS balanced braces;
- document/file presence for binary and Markdown deliverables.

It does **not** install dependencies, run application code, run project tests or
claim functional correctness. Project tests are a separate, explicit sandboxed
action described below.

## Automatic gate

`run_mission_task` attaches verification after files are persisted. In auto-run:

- `failed` → the task is set to `blocked`, auto-run stops with an error, and the
  mission is not marked complete;
- `passed` / `unverified` → normal review/done flow, with the status visible.

## Manual verification

Endpoint:

```bash
curl -X POST http://127.0.0.1:8787/missions/<missionId>/tasks/<taskId>/verify \
  -H 'Content-Type: application/json' -d '{}'
```

The Mission Control task card shows **交付验证 / 运行验证**, the status, evidence
and file hashes. This is how existing tasks can be checked without re-running the
model.

## Real artifact diff

Each task run compares its persisted artifacts with the previous run by artifact
name. It records added/modified/removed files, real added/removed line counts and
a unified diff preview (`verification.artifact_diff`) and stores it on the task.
Mission Control shows this as **文件变更**. First runs show all files as added;
reruns show line-level changes. This is file-level evidence, not a git commit
attestation.

## Sandboxed test execution (1.26.0)

The task panel can run tests only after an explicit confirmation. A supported
sandbox backend is mandatory; if none exists, the result is `unavailable` and
nothing is executed. There is no unsandboxed fallback.

| Backend | Platform | Status |
| --- | --- | --- |
| `macos-seatbelt` | macOS (`/usr/bin/sandbox-exec`) | Implemented and tested on macOS 15/26 |
| `linux-bwrap` | Linux (`bwrap`, unprivileged user namespaces) | Implemented; refuses to run if namespaces/runtime paths are not usable |
| none | Windows / other | Reported `unavailable`; no execution |

Isolation properties:

- network denied;
- user home directory unreadable (a narrow read exception is added only when the
  Python/Node installation itself lives under the home directory);
- only a throw-away workspace is writable;
- host environment secrets are not inherited; a minimal environment is built;
- process group is killed on timeout; output is bounded and truncated safely;
- source artifacts must live under the mission upload directory; symlinks,
  traversal names, oversized files and files outside that root are skipped;
- CPU/file descriptor/file-size limits are applied through `ulimit`.

Supported runners:

- Python `unittest` discovery (`test*.py`, `*_test.py`);
- Python `pytest` when the bridge Python has pytest installed; pytest plugin
  autoload is disabled and the cache provider is off;
- Node `node --test` for `*.test.js`, `*.spec.js` and files under `test/`/`tests/`
  when Node.js >= 18 is available;
- an optional user command such as `pytest -q`, `npm test` or `node --test`.
  The first token must be an allowlisted Python/Node/test runner; it is parsed
  with `shlex` (never a shell string) and still runs inside the sandbox. No
  dependency installation and no network.

Results store the backend, runner, display command, exit code, duration,
timeout/truncation flags, discovered tests, counts, isolation metadata and
output. A failed or unavailable run is evidence; it never marks a task done.
See `tests/test_execution.py`, including network/home/write/env escape tests.

## Model cost (1.27.0)

- AI setup can store an optional per-provider input/output price (per 1M tokens)
  and currency. The bridge computes cost from the provider's real token usage
  after each call; unpriced calls store `cost: null`, not zero.
- The model-call ledger and Mission Eval show costs and per-agent actual cost.
  Mixed currencies are reported as `MIXED` rather than summed.
- Prices are user supplied or a checked-in preset; DeepSeek Flash/Pro presets are
  checked 2026-11-28 from the official page and include cache-hit/cache-miss,
  output and peak/off-peak UTC windows. Chinese public holidays, cache-creation
  premiums, taxes and Search/Fetch API fees are not modeled. The app never
  fetches vendor price lists automatically.

## Evidence receipts (1.26.0, anchor and signing in 1.27.0)

Every task report also creates a **bridge-signed evidence receipt** in
`~/.agent-office/evidence.json` (mode `0600`) using a local HMAC key in
`~/.agent-office/evidence.key` (mode `0600`); the rollback anchor is
`~/.agent-office/evidence.anchor` (mode `0600`). The receipt contains:

- mission/task/agent identifiers, report source and status;
- a SHA-256 of the normalized report;
- artifact IDs, sizes and SHA-256 hashes at report time;
- the receipt sequence number and previous hash;
- the HMAC signature and key id.

Receipts form a hash chain. Verification checks the payload hash, signature,
sequence, previous hash and log head, then optionally re-hashes the current
report and files. It detects a changed report, changed/missing file, edited
receipt, deleted/reordered receipt, wrong key and truncated log tail.

It does **not** prove that the report's claims are true, and it does **not**
prove external-agent identity: the MCP `X-Agent-Id` header is self-declared and
the receipt records `identityBasis: mcp-header`, `identityVerified: false`.
A separate `evidence.anchor` records the latest sequence/head. Rolling back
`evidence.json` alone is detected as a rollback. Rolling back **both** the log and
the anchor is still possible without an external/remote anchor; the UI states
this. Back up `evidence.key` together with `evidence.json` and
`evidence.anchor`: losing or rotating the key makes existing receipts
unverifiable. Never commit them.

Endpoints:

```bash
GET  /execution/capabilities
POST /missions/<missionId>/tasks/<taskId>/run-tests   # {"command": "pytest -q"}
GET  /missions/<missionId>/evidence
POST /missions/<missionId>/evidence/verify
GET  /missions/<missionId>/evidence/bundle
```

Mission Control shows **证据回执**, the chain/verification status, receipt
sequence/hash, artifact count and **验证回执 / 导出 JSON** actions. The signed
bundle contains receipts and verification results but never the HMAC key.

External agents can now upload a text deliverable through the MCP tool
`agent_office_upload_deliverable`, then submit `artifactIds` in
`agent_office_report_task`; the receipt hashes those files.

## External agents

External-agent reports and files are self-reported until a local verification is
run. Since 1.27 an external agent can sign its MCP request with a bridge-issued
32-byte HMAC secret (`X-Agent-Signature` + `X-Agent-Timestamp`). A valid signature
marks the receipt `identityBasis: agent-hmac` / `identityVerified: true`; missing
or invalid signatures fall back to `mcp-header` / unverified. This proves
possession of the local agent secret, not a real-world identity or public-key
attestation. The secret is returned once on agent creation/claim and can be
rotated with `POST /agents/<id>/signing-key`.

## Tests

- `tests/test_verification.py` — syntax pass, syntax failure, placeholder,
  missing file, document-unverified and no-artifact cases.
- `tests/test_evidence.py` — chains, signatures, report/file changes, key
  rotation, rollback anchor, bundles and identity labels.
- `tests/test_execution.py` — network/home/write/env escapes, timeout, output
  caps, traversal, symlinks, custom commands and Linux command construction.
- `tests/test_missions.py` — cost summaries, per-task costs, reprice and restart
  recovery.
- `tests/test_pricing.py` — DeepSeek presets, cache hit/miss, peak windows and
  invalid price tables.
- `dev-missions.html` — verifies the UI panel, evidence receipt surface, custom
  test command, endpoint path and mocked chain state.
- `dev-demo-mode.html` — verifies the demo/real surfaces remain aligned.
