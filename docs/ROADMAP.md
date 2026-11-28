# Roadmap and known gaps

This is an early open-source prototype, not a production observability or agent-execution platform.

## P0 — before publishing

- [x] MIT license, security policy, contribution guide, code of conduct.
- [x] CI syntax checks + required-file checks.
- [x] Screenshots and architecture docs.
- [x] One-time pairing-code flow for external agents.
- [x] English README.
- [x] Bridge integration tests and local Host/Origin checks.
- [x] Optional static GitHub Pages demo workflow.
- [x] Model API adapters: Doubao, DeepSeek, WorkBuddy, Gemini, Claude, OpenAI, Kimi, Qwen, Ollama.
- [x] Create the public GitHub repository, add description/topics/homepage, social preview and a release tag.
- [x] Confirm the MIT copyright holder.
- [ ] Add a short demo video/GIF (optional but recommended for launch).

## P1 — product correctness

- [x] External task delegation: assign backlog tasks, poll assignments, receive progress/completion, write back status with self-report flags.
- [ ] Push delegation to a webhook and verify test/CI evidence automatically.
- [ ] Persist bridge state in SQLite (or document JSON as a demo-only store).
- [ ] Bridge authentication/TLS guidance for non-local deployments.
- [ ] Real run comparison and trace import (OTLP ingest).
- [ ] Replace simulated token/cost/duration with real agent telemetry when available.
- [ ] More robust pathfinding around hot desks and future furniture.

## P2 — engineering

- [ ] Automated browser E2E on CI (Playwright) for the `dev-*.html` pages.
- [ ] Extract CSS into feature modules / design tokens.
- [ ] TypeScript or JSDoc type checking for the engine/event schema.
- [x] Day/night theme, mobile layout checks and 390 px browser self-check.
- [x] One-person company template, role slots, dependency tasks, auto-dispatch.
- [x] Real-time group chat over SSE with room + assignment + execution isolation.
- [x] Chinese/English UI and generated company content.
- [x] Self-update: GitHub release check, local archive install, backup, git/archive apply, verification, bridge restart, rollback and CLI.
- [x] Mission Control: task charter, auto team/plan/assignment, no-idle standby work, groups/DMs, file/image upload, OCR, boss gates, reports with solutions and AI discussion/run.
- [x] Agent recommendations, free team selection, per-task executor overrides, auto brand logos, task time/token estimates and actual-usage evaluation.
- [x] Real-external-agent-first recommendations, editable external job appointments, and built-in/custom avatar selection.
- [x] Pinned left function bar, settings center and QQ/WeChat chat-window styles.
- [x] Two-pane group/DM chat workspace with unread/read state, pin/mute/rename, search, safe Markdown, quote/copy, attachments, @mentions, drafts, details/files and mobile sheet (1.19.0).
- [x] Group creation moved to Communication, built groups listed there, and Mission Control group/DM/chat-workspace entries routed to the new workspace (1.19.1).
- [x] Signal Studio chat redesign, 1020×700 workspace, top-of-rail Group messages shortcut, conversation sections and composer quick actions (1.20.0).
- [x] Company memory (workspace/agent scope, tags, pinning, prompt injection) and universal command-palette search (1.21.0).
- [x] Cross-conversation full-text search across messages and conversations (1.21.0).
- [ ] Token-level streaming replies and message editing/branching.
- [x] Demo/preset shutdown with real-agent-only recommendations and a REAL OPS home view.
- [x] Mission context memory from uploads, decisions, reports, evidence and approved gates.
- [x] Unlimited task execution with per-task token estimates, context insight and a model-call ledger (1.22.0); one-shot auto-retry remains.
- [x] Real-mode office animation parity: live activity feed, mission focus board, routed walking, ambient idle/meeting/celebration states, task bubbles and progress (1.23.0).
- [x] Delivery evidence: file hashes, placeholder rejection and syntax checks; auto-run blocks failed evidence (1.24.0).
- [x] Cinematic mission transitions, live collaboration web, office ambience, held props and real artifact diffs (1.25.0).
- [x] Opt-in macOS sandbox-exec Python test execution with evidence (1.25.0).
- [x] Cross-platform sandbox backends (macOS seatbelt, Linux bubblewrap), Python unittest/pytest, Node --test, allowlisted custom commands, output/timeout limits and explicit `unavailable` fallback (1.26.0).
- [x] HMAC-signed, hash-chained evidence receipts for reports and artifacts, verification UI/export and MCP text-deliverable uploads (1.26.0).
- [x] Optional per-agent HMAC signing keys for MCP requests, rotation UI and receipt identity attestation (1.27.0).
- [x] Optional provider price tables and real token cost accounting in the model-call ledger, usage and mission evaluation (1.27.0).
- [ ] External-agent public-key/third-party attestation, rollback-proof evidence and independent evaluation; local HMAC receipts are not identity signatures (optional HMAC signing exists in 1.27.0).
- [x] Linux bubblewrap real CI execution, including Node `node --test`, read-only `/tmp` and Python 3.11 discovery fixes (1.27.0).
- [ ] Windows native sandbox backend and automatic project-test execution.
- [ ] Fetch and update provider prices automatically; user-supplied prices/cost are done (1.27.0).
- [ ] Durable queue/scheduler, checkpoints and idempotent resume.
- [x] Workspace and agent memory with retrieval and prompt injection (1.21.0); citations and expiry remain open.
- [ ] Agent registry/health and A2A interoperability.
- [x] Deliverable quality gate, focused regeneration, per-task files and ZIP bundles (1.21.1).
- [ ] Provider-backed independent evaluation of deliverable correctness.
- [ ] Estimate calibration from historical actual/estimate variance per role and agent.
- [x] Global search across missions, tasks, chats, messages, files, memories and agents (1.21.0); retention/export remain open.
- [ ] Accessibility audit and keyboard-only pass for all drawers/modals.
- [ ] i18n (zh-CN / en) beyond the README.
- [ ] Packaging: Docker or a `start.sh` that waits for/reuses a healthy bridge.
- [ ] Versioned event protocol and migration for snapshots.

## Known limitations

- External agents only receive tasks through the pull-based assignment protocol; completion is self-reported and not locally reviewed.
- The one-person company needs a real worker bound to each role for real completion; provider API agents are one-shot and excluded from task rooms.
- SSE is localhost-only and unauthenticated.
- Self-update never installs in the background. Automatic update reads the official GitHub release; manual update accepts a local archive newer than the running version. Both require the local bridge to apply/restart. Versions before 1.3.0 need one manual upgrade.
- Mission AI discussion/run requires a reachable model service. Local provider gateways are probed; when none is available the rule plan remains, but agents cannot generate AI deliverables.
- PDF extraction needs `pdftotext`; image OCR needs a vision model or `tesseract`. QR login is an approval gate, not a provider OAuth implementation.
- Mission data is a local JSON store with search but without retention/export or multi-user authentication.
- Model API calls are one-shot; auto-run retries a failed task once, but there is no streaming or durable checkpoint; provider cost is user-configured (1.27.0).
- External agent endpoints are metadata only; the bridge does not call them.
- The bridge has no auth, TLS, multi-tenancy or retention policy.
- Simulation evidence (files/lines/diffs/tokens/cost) is synthetic; real external events carry their own fields.
- Static GitHub Pages cannot run `bridge.py`; the office UI works, but pairing/heartbeats need a local bridge.
