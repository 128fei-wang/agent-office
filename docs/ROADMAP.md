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
- [x] Pinned left function bar, floating group/DM chat, settings center and QQ/WeChat chat-window styles.
- [ ] Provider-backed evaluation of task deliverables and independent QA verification.
- [ ] Estimate calibration from historical actual/estimate variance per role and agent.
- [ ] Retention, search and export for mission history and uploaded artifacts.
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
- Mission data is a local JSON store without search/retention or multi-user authentication.
- Model API calls are one-shot; no streaming, retries or provider price calculation.
- External agent endpoints are metadata only; the bridge does not call them.
- The bridge has no auth, TLS, multi-tenancy or retention policy.
- Simulation evidence (files/lines/diffs/tokens/cost) is synthetic; real external events carry their own fields.
- Static GitHub Pages cannot run `bridge.py`; the office UI works, but pairing/heartbeats need a local bridge.
