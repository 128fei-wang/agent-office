# Changelog

## [1.9.0] - 2026-11-26

### Added
- **AI model settings in Tools**: the tools panel now shows current AI availability, every provider's configuration state, a test action for configured providers, setup steps and a copyable `~/.agent-office/providers.json` example.
- Mission Control's unavailable AI card now has an **AI settings** shortcut that closes the mission and opens Tools.
- AI settings expose configured-but-unreachable local gateways distinctly from unconfigured providers.

### Changed
- Version bumped to 1.9.0.
- API keys remain exclusively in the bridge file/environment; no key input is added to the frontend.
- README, English README and architecture document the Tools AI section.

## [1.8.1] - 2026-11-26

### Changed
- Pinned the six core actions at the top of the TEAM panel in three groups; the full drawer remains available from ☰.
- Reworked the group/DM popup to follow a QQ/WeChat chat-window reference: header avatar/title, message bubbles, composer, and a style switch.
- Replaced the previous QQ/WeChat screen-capture feature with QQ and WeChat **chat-window styles**. No screen capture or screenshot OCR is part of this flow.
- Added Agent / QQ / WeChat style buttons to the left bar, the chat header, and the settings center.
- Removed the window-capture helper, bridge endpoints and related docs.

### Fixed
- The deployed Pages artifact now includes `features.css`.

## [1.8.0] - 2026-11-26

### Added
- **Left function drawer**: TEAM now opens a grouped drawer with **People** (add friend, add external agent), **Create** (create group, task manager/create task), and **Settings center** (tools, settings).
- **Floating group and direct chat popups**: existing mission groups, ad-hoc groups and DMs open in a compact window without leaving the office; messages use the local bridge conversation API.
- **QQ / WeChat window capture**: discover visible QQ/WeChat windows through a native macOS helper and OCR a captured window, or upload a chat screenshot. Results can be copied or sent to the active chat.
- **QQ / WeChat chat styles**: settings can switch popups between the default Agent style, a compact QQ style and a WeChat style.
- **Settings center**: theme, language and chat-window style in one modal.
- `GET /chat-capture/windows` and `POST /chat-capture/window`; arbitrary window IDs are rejected and temporary screenshots are deleted after OCR.
- Browser self-check `dev-features.html` and screenshots for the drawer and chat popup.

### Changed
- Version bumped to 1.8.0.
- The old TEAM footer buttons remain as hidden compatibility hooks; visible actions move into the drawer.
- README, English README, architecture, security and repository checks document the new shell, capture permission and modules.

## [1.7.0] - 2026-11-25

### Added
- **Real-external-agent-first recommendations**: `/missions/recommend` now ranks only connected external agents whenever at least one exists. Built-in AI roles are used only as the fallback when no external agent is available; the normal system division and manual selection of built-in roles are unchanged.
- **Editable external appointments**: every external agent can be appointed to chief, product, content, design, engineer, QA, growth, video or operator in its drawer, or left on skill-based auto-assignment. The role is persisted through the bridge and used immediately by recommendation scoring and mission assignment.
- **Built-in and custom avatars**: auto brand detection plus a preset avatar catalog (bot, fox, owl, cat, rocket, star, ghost, alien, spark, builder, lead) and custom initials with a validated color. Avatars render in the external list, external drawer, team roster and Mission Control.
- `GET /agents` now returns `meta.roles` and `meta.avatars`; `PATCH /agents/<id>` accepts `role`, `avatar`, `avatarText` and `avatarColor` with validation.
- The external list gets a profile button that opens the role/avatar drawer.

### Changed
- Version bumped to 1.7.0.
- Mission recommendation responses expose `scope` (`external` or `system`) and the candidate count; the form labels external-first recommendations clearly.
- External agent role labels are preserved separately from the display name, so the picker shows both the agent name and its appointed role.
- README, English README, Mission docs, architecture, security, roadmap and browser self-checks document and cover the new flow.
- Tests cover external-first recommendation, system fallback, appointment validation, preset/custom avatars and bridge persistence.

## [1.6.0] - 2026-11-25

### Added
- **Free team selection and per-task executors** in the mission form: choose any available agents, and override the executing agent for each recommended task. Recommended choices stay visible and one manual edit preserves the rest of the team.
- **Agent recommendation engine**: `/missions/recommend` ranks agents by skill overlap, role match, online state and current workload, returns a top-3 list per task, a suggested team, a recommended executor per task and a human-readable match reason.
- **Automatic concrete assignment**: recommended executors are sent as `preferredExecutors`; the bridge assigns each task to that concrete agent (or the best available member), and records the assignment reason and estimate.
- **Automatic agent brand logos**: Codex, Claude, WorkBuddy, Gemini, DeepSeek, Doubao, Kimi, Qwen, Ollama and OpenAI are detected from an agent's name/runtime; other external agents get deterministic initials. Logos appear in team cards, the external agent list/drawer, mission members, chat reports and the recommendation picker.
- **Time and token estimates**: per-task estimates based on role baseline, description complexity, skill match and current load, with a confidence level and match percentage.
- **Actual usage evaluation**: actual minutes, model duration, token input/output, per-task variance, per-agent workload and deadline risk in a new **Eval / 评估** tab. AI discussion and AI task-run usage is stored on the mission, the report message and the task.
- **Per-task executor preview**: changing the executing agent updates the time/token estimate before the task is created.

### Changed
- Version bumped to 1.6.0.
- External agent API responses include auto-detected `brand`, `logoText`, `logoColor` and `logoSource`; the mission agent directory does the same for every source.
- Mission evaluation now includes discussion overhead, actual model duration and per-agent usage.
- Report cards show an inline token/latency badge; Team cards and the external drawer use brand marks instead of a generic arrow.
- Browser self-checks now cover recommendation cards, free team selection, per-task executor overrides, logo rendering, estimates and the Eval tab.
- Tests cover recommendation output, logo detection, estimates, actuals, preferred executors, AI usage and bridge recommendation responses.

## [1.5.0] - 2026-11-25

### Added
- Mission Control workspace: new task charter, automatic team selection, dependency-aware plan and skill-based assignment with a reason on every task.
- Task groups, ad-hoc group chats and one-to-one DMs with live SSE updates and unread markers.
- Document and image attachments; text/Markdown/CSV/JSON/HTML/DOCX/XLSX extraction, optional PDF extraction, and on-demand image OCR via a vision provider or `tesseract`.
- Mission rules: only spend, final business calls, QR login and authorization may go to the boss. Technical escalations are rejected by the bridge.
- Boss approval inbox with amount, options, scopes, service, QR/link attachments, one-time resolve and approval messages in the task thread.
- Structured reports with done/next/risks/solution/evidence; a report without a solution is rejected. Reports create valid boss approvals when needed.
- No-idle coverage: every member gets a primary task or a useful risk/evidence/acceptance standby task, with a coverage card and assignment reasons.
- AI discussion via a configured model provider, plus per-task AI execution producing a Markdown deliverable and a structured report.
- External agent mission protocol: `/mission-tasks?agentId=`, `PATCH /mission-tasks/<id>`, full `docs/MISSIONS.md`.
- Mission screenshot, browser self-check, bridge integration coverage and seven mission unit tests.

### Changed
- Version bumped to 1.5.0.
- README, English README, architecture, security, roadmap and docs now document Mission Control.
- The bridge health payload reports mission and pending-approval counts.

## [1.4.0] - 2026-11-25

### Added
- Top-bar **Tools / 工具** entry with the update center, manual update and maintenance commands in one place.
- Manual upgrade from a local `.tar.gz`, `.tgz`, `.zip` or `.tar` release archive; no GitHub check required.
- Manual archive validation: version must be newer, traversal/symlink/encrypted/oversize entries are rejected, and the archive is verified before writing.
- Bridge manual upload API: `GET /update/manual/token`, `POST /update/manual` (raw archive, 80MB cap, one-time token).
- `./update.sh --manual <archive>` for terminal upgrades.
- Tools panel shows copyable CLI commands and the backup folder.
- Zip extraction safety and updater tests for manual tar/zip, same-version rejection and zip traversal/symlink attacks.

### Changed
- Version bumped to 1.4.0.
- Update center title and button now read **Tools / 工具**; automatic and manual flows share the same backup, progress, restart and rollback path.
- README, English README, upgrade guide, architecture and roadmap document manual upgrades.

## [1.3.0] - 2026-11-25

### Added
- In-app self-update center: check the official GitHub release, view release notes, update, restart the bridge and reload the page.
- Terminal updater `update.sh` with `--check`, `--apply`, `--rollback`, `--status` and `--json`.
- Bridge update API: `GET /update/check`, `GET /update/status`, `POST /update/apply`, `POST /update/rollback`.
- Automatic local backups under `~/.agent-office/backups` and one-click rollback to the previous version.
- Git mode uses a clean fast-forward; archive mode updates non-git deployments from the official release tarball.
- Tokens are one-time and expire after 10 minutes; the app backs up before writing and auto-restores if verification fails.
- Archive validation for traversal, symlinks, device entries, size and required files; Python files are compiled before restart.
- `docs/UPGRADING.md` and `dev-update.html` self-check.

### Changed
- Version bumped to 1.3.0.
- README and English README document update behavior, API and rollback.
- Bridge `/health` now reports `version` and `bootId`; update state survives a bridge restart via `last-update.json`.

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
