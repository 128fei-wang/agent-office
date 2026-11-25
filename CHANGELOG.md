# Changelog

## [1.2.0] - 2026-11-25

### Added
- One-person company workspace: 8 role slots, 11 dependency-aware tasks, 4 department channels and isolated task rooms.
- Automatic task dispatch and dependency unlock; role-bound pairing codes bind real workers to role slots.
- Real-time group chat over Server-Sent Events (`/stream`) with message history.
- Execution isolation: task-room messages require matching agent, room, assignment and executionId; wrong-room reports are rejected.
- Company task board, role org chart, chat, deliverables and task isolation UI.
- Chinese/English UI switch in the top bar and company header, `?lang=en|zh`, persisted in localStorage.
- English translations for shell controls, task statuses, company template, chat and generated company content.
- Company OS docs, `dev-company.html`, `dev-i18n.html`, and company screenshot.

### Changed
- Version bumped to 1.2.0.
- README and English README document company, chat, isolation and bilingual behavior.

## [1.1.0] - 2026-11-25

### Added
- External task delegation: backlog task → assignment → progress/completion/failure writeback.
- Pull-based assignment API (`GET/POST /assignments`, `PATCH/DELETE /assignments/<id>`) with scenario/run scoping.
- Self-reported external completion: unverified checks become risk/missed and remain in the audit/release gate.
- Demo agent automatically advances its assignments.
- Day/night theme toggle (`D` / sun-moon button), persisted in localStorage.
- Day skin for panels, drawers, Trace Lab, external-agent modal and provider rail.
- Mobile layout checks at 390 px, horizontal control rail, full-width drawers/modals.
- `docs/TASK_DELEGATION.md`, `dev-delegation.html`, `dev-theme.html`.
- New day-mode and mobile screenshots.

### Fixed
- External provider cards now render after the first polling refresh.
- Tests tolerate pre-existing external agents instead of assuming a clean bridge.

### Changed
- Version bumped to 1.1.0.
- README and English README document delegation, themes and mobile behavior.

## [1.0.0] - 2026-11-24

Initial open-source preparation.

### Added
- Pixel-art multi-agent office simulation with two scenarios.
- Task board, reviews, meetings, blockers, coffee/chat behavior and celebration.
- Work ledger with per-agent attribution, skills, file/line evidence, diffs and quality checks.
- Audit panel with baseline coverage, risk/missed/rewind metrics, release gate and agent shift.
- Trace Lab: run/task/event spans, execution timeline, replay scrubber, span detail, Evals, OTLP JSON.
- Human-in-the-loop release approval and rejection.
- Local hires with hot desks, onboarding tasks, persistence and rename.
- Local external-agent bridge: one-time pairing codes, setup.md, claim, heartbeat, event ingestion, demo agent and external agent drawer.
- Rename local and external agents; local names persist across reload.
- localStorage snapshots and audit reports (Markdown / JSON / standup).
- Responsive layout, keyboard shortcuts, local self-check pages and screenshot assets.
- Bridge integration tests, CI syntax/required-file checks and an optional GitHub Pages static demo workflow.
- Model API provider rail: Doubao, DeepSeek, WorkBuddy, Gemini, Claude, OpenAI, Kimi, Qwen, Ollama.
- Bridge adapters for OpenAI-compatible, Anthropic Messages and Gemini generateContent, with token usage written to the ledger.
- Provider keys stay in bridge env or `~/.agent-office/providers.json`, outside the static web root.
- English README plus architecture, pairing, event-protocol and roadmap docs.

### Known gaps
- External agents are observable-only; they cannot claim/complete simulation tasks yet.
- Bridge has no auth/TLS and is localhost-only; non-local Host/Origin requests are rejected, but this is not a substitute for authentication.
- Trace telemetry for the simulation is deterministic synthetic data; real agent events are separate.
- No automated browser CI yet; self-check pages are manual.
