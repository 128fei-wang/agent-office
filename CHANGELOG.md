# Changelog

## [1.18.2] - 2026-11-27

### Fixed
- **Turning demo off no longer traps the workspace behind a full-screen REAL OPS cover**. It now lands directly in the real workspace with the compact dismissible “真实运营模式” card; the topbar **真实模式面板** button opens the detailed panel when needed.
- Updated demo-mode and guide self-checks for the non-blocking transition.

### Changed
- Version bumped to 1.18.2.

## [1.18.1] - 2026-11-27

### Fixed
- **Stale local install made the left feature rail unstyled**: AgentOffice.app runs `/Users/hashmai/agent-office`, which was still a partial 1.7-era copy without `features.css` / `demo-mode.css`. The repo was verified, but the actual installed app was not. The installed copy is now synced to 1.18.1 and the running bridge restarted with the current code.
- Added `scripts/sync-local.sh` to copy the working tree into the installed app while preserving local state/secrets.
- Added a browser regression check asserting the feature rail has real width/border-radius and horizontal labels, so a missing CSS install fails self-checks instead of silently rendering an unstyled rail.
- Documented the stale-install symptom and fix in `docs/GUIDE.md`.

### Changed
- Version bumped to 1.18.1.

## [1.18.0] - 2026-11-26

### Added
- **Real-mode office parity**: real mode now keeps the office stage and its ambient animation alive, renders external agents at desks with brand marks and online state, shows real metrics in the topbar, a working team-morale score, and a live REAL OPS activity feed instead of a static empty panel.
- **Real-mode stage panel**: the closed REAL OPS panel becomes a compact dismissible status card; the topbar gains a Mission Center shortcut and the approval badge remains actionable.
- **Comfortable UI density**: Settings → Display density offers Comfortable (larger task/report/approval text on desktop) and Compact; Comfortable is the default.
- **Scheduled auto-run**: missions can set a start time; the bridge scheduler starts due missions automatically, with a Scheduled status in Mission Control and MISSION LIVE.
- **Mission lifecycle**: archive/unarchive, duplicate a mission with its team and charter, and a dedicated Archived filter.
- **Batch task actions**: select tasks in Mission Control to accept reviews or mark them blocked in one pass.
- **Agent health check**: external agent dossiers gain a Test heartbeat action and report success/failure.
- **Animation performance**: the sprint board now skips unchanged rebuilds using a task/progress signature, and `dev-performance.html` covers 72-task board and roster rendering.

### Fixed
- Real mode no longer freezes stage animations or hides team morale; PAUSED is only shown for an actually paused demo.
- Real stats, morale, mission-center button and real feed update on the mission SSE/poll cycle.

### Changed
- Version bumped to 1.18.0.
- `docs/ACCEPTANCE.md` updated to the 1.18 scorecard and verification evidence.

## [1.17.0] - 2026-11-26

### Added
- **Command palette**: `Cmd/Ctrl + K` (or `?command=1`) opens a searchable command palette for new missions, Mission Control, Boss Inbox, external agents, AI setup, guide, settings, tools, demo toggle, theme, language, fullscreen, missions and external agent dossiers. Arrow keys, Enter and Esc are supported.
- **Mission quick templates**: the create form offers E-commerce, Content, Product launch and Incident review templates that prefill goal, acceptance, priority and token budget.
- **Bulk approvals**: Boss Inbox pending spend/login/authorization approvals can be selected and approved/rejected together; decision gates stay individual because they need an option choice.
- **Message search**: search the loaded conversation transcript with live match counts, no-results state and preserved input focus.
- **Task editing**: edit a task title, brief, acceptance and priority from Mission Control; changes persist through `PATCH /mission-tasks/<id>`.
- **Real-time mission overview stream**: `/missions/stream` now emits an `overview` revision event whenever tasks, progress, auto-run, approvals, files or conversations change; Mission Control and Mission Live react in ~0.35s instead of waiting for the next 2.5–5s poll. Polling remains as fallback.
- **UI/layout polish**: command palette styling, mobile stage-tool cleanup, reduced-motion support, subtle card transitions, and template/bulk/search styles.

### Changed
- Added `docs/ACCEPTANCE.md` with the 9.8 scorecard, GitHub peer comparison and the remaining UI/scale/animation gaps.
- Mission templates leave the monetary budget blank to avoid creating an unnecessary spend approval at creation; token budget is still prefilled.
- Version bumped to 1.17.0.

## [1.16.1] - 2026-11-26

### Fixed
- **Doubao avatar**: the Doubao brand entry now uses the multicolor Doubao mark instead of the ByteDance corporate bars, so the Doubao agent card, drawer, mission cards and chat avatars identify the right product. Added a regression test for `Doubao → assets/logos/doubao.svg`.
- **Real-mode panel can be closed**: the REAL OPS cover now has a close button (and `Esc`), and closing it keeps real mode on instead of forcing a demo restore. Dismissal is remembered locally; a compact stage note links to Mission Control or reopens the panel, and a topbar **真实模式面板 / Real panel** button toggles it. Turning demo off again resets the panel so the status is shown once more.

### Changed
- Version bumped to 1.16.1.

## [1.16.0] - 2026-11-26

### Added
- **Acceptance review pass — per-agent progress everywhere**: Mission Control task rows, the task filter, member cards, the office inspector, the local agent dossier and the external agent dossier now all show progress bars and the agent's current task. The stage task drawer adds live progress and elapsed state.
- **Task actions from Mission Control**: accept a review task, send it back, mark it blocked (with reason) or reassign it to another member. Backend task records now persist real `progress` (0–100) and `blockedReason`.
- **Boss Inbox context and history**: every approval now shows its mission, task, requester and request time, with an **Open mission** action; decision gates render option cards with pros/risks. Pending / Resolved / All filters use the bridge approval history, and a mission's Approvals tab is scoped to that mission.
- **File downloads and Files-tab upload**: every file row and the preview modal link to the raw artifact, and the Files tab can upload more files with retry.
- **Mission archive and deletion**: export a Markdown archive (charter, tasks, reports, approvals, files, decisions, transcript) from the mission header, and delete a mission with confirmation from the overview danger zone.
- **Approval notifications**: Mission Live keeps a pending-approval badge on the Mission button and the Work rail icon and raises a toast when a new approval arrives.
- **Drawer history and live refresh**: task/agent dossiers refresh while the simulation runs, preserve scroll and focus, and gain a back button when navigating task ↔ agent.
- **Inbox / search / mobile fixes**: approval filters, immediate mission search with preserved focus, distinct no-results copy, a mobile back button, list-first Mission Control on narrow screens, and connection-loss retry banner.
- **Pause and completion clarity**: paused simulation freezes stage animations, marks TEAM / HUD as PAUSED, the completion banner sits outside the scaled stage with the real release-gate result and an **Open audit** action, and reset/scenario changes ask for confirmation.
- **Real-mode containment**: local task/agent drawers close when demo is turned off, the Work flyout explains disabled simulation actions, and Company / Trace shortcuts are blocked in real mode.
- **Mobile office usability**: scaled agent hit boxes keep a ~44 px touch target, tapping an agent opens the full dossier, the inspector is hidden on phones, and the real-mode cover scrolls on short screens.

### Changed
- Mission list rows now derive display status from auto-run / approvals / blocked / review state and show last activity in the tooltip.
- AI auto-run now states that review tasks are auto-accepted and can be sent back, blocked or reassigned manually.
- Version bumped to 1.16.0.

## [1.15.0] - 2026-11-26

### Added
- **Topbar demo switch**: a visible **DEMO ON / DEMO OFF** button in the topbar toggles local simulation instantly, and stays visible when demo is off so restoring is obvious.
- **In-app usage guide**: open via the topbar **Guide** button, left settings flyout, all-features drawer, the demo-off cover, the `?` shortcut or `?guide=1`. It includes a live demo status and one-click actions for demo toggle, external agents, AI, missions and tools.
- `docs/GUIDE.md`: full first-use guide covering demo shutdown, real agents, 3-step AI, missions, approvals, token caps, next round and troubleshooting.
- `dev-guide.html` browser self-check for the topbar switch and the guide.

### Fixed
- **Partial AI reports no longer stop auto-run**: missing `done / next / risks / solution / evidence` are repaired with explicit reviewable defaults, and the repair is recorded as a risk. This addresses tasks stopping at 2/7 with “report must include…” errors.

### Changed
- **Real-mode is no longer a dead end**: the REAL OPS cover now shows AI availability, active/incomplete real missions (click to open), a clear explanation that offline external agents can still run under the local AI, and primary actions for Create real mission, Mission Control, Manage agents and Connect AI.
- Version bumped to 1.15.0.
- README and README.en add a first-use callout and link the guide.

## [1.14.2] - 2026-11-26

### Added
- **Next round after completion**: a completed mission now shows **Start next round** in the command bar and overview. It reuses the same team, carries the previous mission link, deliverables, decisions and report summaries as context, and starts auto-run again when the previous round used it.
- **Completed coverage state**: a finished mission no longer shows the false “Agent idle” warning; coverage reads “round complete · everyone wrapped up”.

### Fixed
- Mission selection no longer races the initial Mission Control refresh; a stale load can no longer replace the mission the user just selected.

### Changed
- Version bumped to 1.14.2.

## [1.14.1] - 2026-11-26

### Fixed
- **Completed office no longer freezes**: celebration is now a one-shot state; after a finished sprint agents return to an ambient loop of chatting, coffee, wandering, board review and short celebrations. The SHIPPED banner gains a **New sprint** button.
- **Task ↔ animation linkage**: working/reviewing characters show a task progress bar under the name, team cards show `task · NN%`, and idle/chatting/reviewing sprites have ambient animations.
- **Stalled task watchdog**: a task with no progress for 24 ticks is re-dispatched to its owner, or returned to the backlog if nobody is on it; recovery is written to the feed and ledger.
- **Long real auto-run tasks look alive**: MISSION LIVE HUD and hot-desk card show an elapsed timer; the HUD has a direct **Stop** action. The bridge records `currentTaskStartedAt` per task.
- Test isolation: bridge integration tests now use a temporary `BRIDGE_STATE_DIR`, so tests can never create or delete missions in the local user workspace.

### Added
- `docs/ANIMATION.md` with the state-machine patterns reviewed and implemented.
- `dev-activity.html` self-check for task progress, one-shot celebration, ambient movement and New sprint.

### Changed
- Version bumped to 1.14.1.
- README / README.en document the animation state machine and new tool.

## [1.14.0] - 2026-11-26

### Added
- **Demo & preset shutdown**: a new **Settings → Demo & presets** control (also in the left settings menu, feature drawer and Tools panel) turns off the six local simulation roles, scripted tasks and the demo agent. Real missions, uploads, approvals and external agents are preserved. When off, the office switches to a clear REAL OPS view with a real-mission board and real-external-agent list.
- **Real-agent-only missions**: while demo mode is off, Mission Control recommendations and new mission members are restricted to connected external agents. Recommendation returns an explicit external-only empty state instead of silently falling back to system presets; new mission creation rejects preset roles.
- **Mission context memory**: AI discussion and task execution now receive uploaded file text, team decisions, completed task reports, evidence and approved boss gates as context. Context is labelled as untrusted reference material and cannot override safety rules, secrets or approvals.
- **Token budget guardrail**: missions accept an optional token cap, shown in evaluation and auto-run. Auto-run stops cleanly at the cap, reports usage, and the cap can be edited from the evaluation tab to resume. Discussion tokens and task tokens both count.
- **Auto-run retry**: a failed task is retried once after a short delay; retry state and token usage remain visible in the mission record.
- `docs/TRENDS.md` with the 2026 agent-platform trend review, gap analysis and roadmap, plus a browser self-check for demo mode and new Python tests for real-only recommendations, token budgets and context prompts.

### Changed
- Version bumped to 1.14.0.
- Mission overview shows token budget usage and a context hint; auto-run cards show tokens used/cap.
- README and AI setup docs cover the real-agent mode, context memory and budget guard.

## [1.13.0] - 2026-11-26

### Added
- **Real external-agent logos**: Codex, Claude, WorkBuddy, Gemini, DeepSeek, Doubao, Kimi, Qwen, Ollama and OpenAI auto-detect bundled SVG brand logos; preset/custom avatars still override. Codex uses its own mark and WorkBuddy uses its cat brand mark. Unknown agents fall back to initials; a safe custom `logoUrl` is supported.
- **Mission live in the office**: while auto-run is active, the home page shows a MISSION LIVE HUD, the executing agent logo at a hot desk, an animated task bubble on the matching local character, and a highlighted team card with task/progress.
- **Brand logo assets and docs**: bundled offline logos under `assets/logos/`, with attribution, plus a mission-live browser self-check.

### Changed
- Version bumped to 1.13.0.
- README, AI setup docs and self-checks cover brand logos and home-office mission activity.

## [1.12.1] - 2026-11-26

### Fixed
- The 3-step AI setup now uses the configured bridge URL instead of always calling `127.0.0.1:8787`.

### Changed
- Regenerated the public README screenshots from a clean demo state with generic local agents and demo data. Personal external-agent names, IDs, missions and model endpoint details are no longer shown.
- Removed the old task-delegation screenshot that showed a personal external agent.
- MCP examples use a generic `ext-demo-agent` identity.
- Version bumped to 1.12.1.

## [1.12.0] - 2026-11-26

### Added
- **Mission command bar**: every mission now shows a persistent four-stage strip (讨论 → 审批 → 执行 → 汇报) and a labelled next action across all detail tabs. The bar says whether the founder needs to act, what is waiting, and what will happen next.
- **One-click existing missions**: a mission whose discussion is complete but never started now shows **Start N tasks**; a mission with no plan shows **Discuss & run**, which discusses and executes in one click.
- **Discussion handoff message**: when a discussion finishes, the chat receives a clear next-step message instead of leaving the user guessing.
- The auto-run overview card is now informational; the command bar is the single run/stop/approval control.

### Changed
- `POST /missions/<id>/autorun` accepts `{"discuss": true}` to force discussion before execution.
- The AI discussion card's action is now a secondary **Discuss only / Discuss again**, so it no longer competes with the primary next action.
- Version bumped to 1.12.0.

## [1.11.1] - 2026-11-26

### Fixed
- Claude-compatible providers now send either `Authorization: Bearer` (for `ANTHROPIC_AUTH_TOKEN`) or `x-api-key` (for `ANTHROPIC_API_KEY`), not both. This avoids gateways that reject mixed auth headers.
- Saving detected environment credentials persists the matching auth type, so a saved bearertoken continues to work after the bridge restarts without that environment variable.

## [1.11.0] - 2026-11-26

### Added
- **AI setup in three steps**: provider cards → connect (environment or API key) → test and enable. Built-in providers cover Doubao, DeepSeek, WorkBuddy, Gemini, Claude, OpenAI, Kimi, Qwen and Ollama, with local gateway readiness shown before selection.
- **Environment credential detection**: the bridge recognises `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, `OPENAI_BASE_URL`, `OPENAI_API_BASE` and similar gateway variables, and identifies the source as `environment` without exposing the value to the page.
- **Test-before-save**: `POST /providers/<id>/configure` validates and performs a real minimal call, then writes `~/.agent-office/providers.json` atomically with mode `0600`. A failed test never overwrites existing settings.
- **Full auto-run**: missions can run discuss → assign → execute → report automatically. Dependency-ready tasks execute in order; reports, Markdown deliverables and token usage are archived; approving a boss gate resumes the run.
- **Auto-run status card**: progress, current task, waiting-for-approval, completion and error states, with start/resume, stop and approval shortcuts for existing missions.
- `docs/AI_SETUP.md` and new AI setup screenshots.

### Fixed
- AI no longer appears unavailable when a Claude-compatible gateway supplies `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` instead of `ANTHROPIC_API_KEY`.
- Long tasks no longer fail with an empty provider response when a DeepSeek Anthropic-compatible gateway spends the whole token budget on thinking; thinking is disabled for that gateway and task budgets were raised.
- Invalid AI-generated boss gates (for example `authorization` without scopes) are recorded as a risk and skipped instead of aborting the whole mission.
- Mission form labels inherited oversized text, and auto-run was buried below the file picker; labels are fixed and auto-run now sits directly below priority/budget/deadline.
- A stale “AI unavailable” discussion message now shows “AI is ready; run the discussion again” once a model is connected.

### Changed
- Version bumped to 1.11.0.
- README, provider docs, security docs and browser self-checks cover the three-step setup and auto-run flow.

## [1.10.1] - 2026-11-26

### Changed
- **One navigation source**: the topbar now only holds scenario, play/pause and speed. Task center, one-person company, meetings, incidents, reset, tools, theme and language moved into the left rail.
- Added a **Work** rail group; theme and language now sit in the Settings flyout, and update availability also shows on the Settings rail icon.
- Widened the rail and enlarged its labels for readability.
- Added `docs/LAYOUT.md` with GitHub peer research and layout rules, plus `docs/MCP.md` with endpoint, protocol, tools and limits; both are linked from the READMEs.
- Updated browser self-checks and the Function rail screenshot.
- Version bumped to 1.10.1.

## [1.10.0] - 2026-11-26

### Added
- **MCP deployment**: Tools can expose Agent Office at a local MCP endpoint (`POST /mcp`) and generate client configuration bound to a selected external agent. Includes initialize, tools/list, status, agent/task listing, task reports, chat messages and conversation listing.
- **Left navigation rail**: replaced the cramped top function strip with a clearer icon rail and click-out flyout groups for people, create, settings and chat.

### Changed
- Version bumped to 1.10.0.
- MCP uses `X-Agent-Id` as identity (not authentication); the bridge remains localhost-only.
- README, English README, Mission docs, architecture, security and browser self-checks cover MCP deployment and the rail layout.

## [1.9.1] - 2026-11-26

### Changed
- Reworked the top-left functions into a readable, collapsible drawer: larger labels, grouped rows, a clear header with fold state, and persisted open/closed state.
- All six actions remain clickable and open their existing modals, Mission Control forms or chat popups; the full ☰ drawer is still available.
- The chat-style switch remains in the expanded drawer and the QQ/WeChat popup header.

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
