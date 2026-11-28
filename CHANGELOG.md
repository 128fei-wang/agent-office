# Changelog

## [1.28.0] - 2026-11-28

### Added
- **Product mark and complete install identity**: a new pixel mark — a teal A-shaped office roof, three agent pixels at a desk, an amber crossbar and a completion check — plus a pixel wordmark and the line **SEE THE TEAM. SHIP THE WORK.** All artwork is bundled locally; the runtime makes no external image or font request.
- **Every install surface**: SVG favicon + 16/32/48 PNG + `favicon.ico`; 180px Apple touch icon; PWA `site.webmanifest` with 192/512 `any` and 512 `maskable` icons, plus a network-only service worker so the manifest is installable without caching stale UI; 1200×630 Open Graph/Twitter card; macOS `AppIcon.icns` and a 10-size iconset; Windows ICO; `agent-office-logo.svg` / PNG lockup.
- **Header and boot branding**: the top-left 3×3 block placeholder is replaced by the 36px mark, and the boot sequence now opens with the 64px mark. Both respect reduced-motion settings; the mark is scoped to the header so external-agent glyph styling is untouched.
- **macOS installed-app icon**: Chromium-based bundles can keep using their `Assets.car` `AppIcon` when `CFBundleIconName` is set. `scripts/install-macos-icon.sh` writes a unique `AgentOfficeIcon.icns`, sets `CFBundleIconFile=AgentOfficeIcon`, removes `CFBundleIconName`, re-signs ad-hoc and refreshes LaunchServices/Dock. Runtime `NSWorkspace` icon was verified after the change.
- **Brand guide and build pipeline**: `docs/BRAND.md` documents the concept, palette, clear-space/size rules, install surfaces and replacement steps. `scripts/build-icons.sh` + `scripts/render-svg.py` regenerate every raster/ICNS/ICO asset on macOS with Chromium; generated assets are committed, so users need no build step.
- **Verification**: `tests/test_branding.py` checks 19 brand/install files, PNG dimensions, manifest icon resolution, index favicon/Apple/PWA/OG/Twitter metadata, root favicon parity, remote-reference absence, ICNS/ICO containers and iconset sizes. `dev-brand.html` is a new browser self-check included in the smoke suite. Both READMEs now show the lockup.

### Verified
- Python: **139** tests pass (1 Node test skipped because Node.js is not installed on this machine).
- Browser: **29/29** pages pass, including the new `dev-brand.html`; smoke subset **6/6**. The `dev-ai-setup` UI check was made deterministic when the shared bridge has no real provider configured.
- `scripts/check.sh` passes; header and boot screenshots verified in night and day themes at 1440px and 520px widths; icon sizes verified 16–1024; installed macOS icon verified through `NSWorkspace` after removing the stale asset-catalog override.

### Still not 9.8
- This release closes the missing product identity/install surfaces, not the production gaps: public-key identity, native Windows sandbox, multi-tenancy, streaming/durable checkpoints, bridge modularization, accessibility/load/security audits, automatic vendor price updates and independent evaluation remain open. The current self-score remains **8.8 console / 7.7 production**; 9.8 is the target, not a claim.

## [1.27.0] - 2026-11-28

### Added
- **Provider price tables and real cost accounting**: AI setup can store optional input/output prices per 1M tokens and a currency per provider. The bridge computes cost from the provider's actual token counts after each response and stores it on the model-call ledger. DeepSeek ships a preset checked 2026-11-28 from the official page: Flash/Pro cache-hit, cache-miss, output, peak/off-peak windows; cached tokens are parsed from provider usage. Usage shows cost statistics/rows/details; mission evaluation shows model cost, per-task cost and per-agent actual cost. Missing price tables render `—`, not zero; mixed currencies render `MIXED`.
- **Signed MCP requests**: agents receive a one-time 32-byte signing secret on creation/claim. `X-Agent-Timestamp` + `X-Agent-Signature` sign the exact JSON-RPC body with HMAC-SHA256. Valid signatures mark evidence receipts `identityBasis: agent-hmac` and `identityVerified: true`; missing signatures remain self-declared, while invalid/expired/replayed signatures are rejected. Secrets can be rotated with `POST /agents/<id>/signing-key`; the UI exposes a signing-key action and never puts the secret in public agent data, browser storage or exports.
- **Linux sandbox preflight**: bubblewrap is tested with a real namespace probe; if user namespaces are unavailable the result is `unavailable`, not a fake test failure or unsandboxed fallback.
- **State hardening**: `bridge-state.json` is now written atomically with mode `0600` because it contains per-agent signing secrets.
- **Validation fixes**: real pytest execution exposed a venv-symlink runtime-root bug; GitHub Actions Python 3.11 exposed unittest absolute-path/hyphenated-workspace issues; Linux bubblewrap exposed a writable `/tmp`. All are fixed with regression coverage.
- **Restart recovery**: bridge startup marks auto-run/discussion states left `running`/`queued` as interrupted instead of leaving the UI stuck. Model work is not blindly restarted (to avoid duplicate spend); the mission can be resumed explicitly.
- **Real validation**: a temporary state clone ran one real provider task (512/5165 tokens, 10 artifacts), produced a valid evidence receipt with a validation price table cost of 0.010842 USD (DeepSeek Flash official reference: 0.0031758 off-peak / 0.0063516 peak, cache-miss), and a real pytest sandbox run found 3 passed / 3 failed model-generated tests. See `docs/VALIDATION_1.27.md`.

### Verified
- Python: **129** tests pass (1 Node test skipped because Node.js is not installed on this machine).
- **CI green**: full Python 129 tests; Linux bubblewrap 19 tests (including Node `node --test`, `/tmp` read-only); Windows compatibility; browser smoke. Locally `dev-missions.html`: **134** checks, `dev-demo-mode.html`: 88 checks, browser runner: 28/28 pages.
- Cost is user-supplied and does not include cache/batch discounts or taxes. Replay protection is in-memory and resets on bridge restart.
- Still not 9.8: HMAC is not public-key/real-world identity, whole-file evidence rollback is not prevented, Windows has no sandbox backend, Linux is not exercised on this machine, and model prices are not fetched automatically.

## [1.26.0] - 2026-11-28

### Added
- **Cross-platform test executor**: `execution.py` now requires a real sandbox backend (macOS `sandbox-exec`, Linux `bubblewrap`) and reports `unavailable` instead of silently running unsandboxed. It supports Python `unittest`, Python `pytest` when installed, Node `node --test` (Node >= 18), and an allowlisted custom test command. Network is denied, home reads are denied, only a throw-away workspace is writable, host secrets are stripped, output is bounded, and the process group is killed on timeout.
- **Sandbox escape tests**: real tests attempt outbound connections, home-directory reads, `/tmp` writes, host-secret inheritance, traversal names, symlinks, oversized output and timeouts; all are blocked or bounded as expected.
- **Evidence receipts**: every report creates an HMAC-SHA256-signed receipt with the report hash, artifact SHA-256s/sizes, sequence number, previous hash and key id. `evidence.py` verifies the payload, signature, hash chain, log head, current report and current files. The UI adds **证据回执 / 验证回执 / 导出 JSON** and labels the result honestly: local tamper evidence, not external identity and not rollback-proof.
- **MCP deliverables**: `agent_office_upload_deliverable` lets an external MCP agent attach a text file to its task; `agent_office_report_task` accepts `artifactIds`, and the evidence receipt hashes them. External identity remains self-declared (`mcp-header`, not verified).
- **Executor UI**: task cards show the sandbox backend, runner, command, timeout/truncation flags and a custom test-command field. `POST .../run-tests` accepts an optional `command`.
- **Capabilities endpoint**: `GET /execution/capabilities` exposes backend/runtime/limits and why a runner is unavailable.

### Changed
- Evidence and verification are separate: a task can be file-verified but have no receipt, or have a valid receipt with a changed report; both are shown independently.
- Discussion thread shutdown is defensive when a mission is deleted while a model call is in flight; `set_discussion` is lock-protected.

### Verified
- Python: **114** tests pass (1 Node test skipped because Node.js is not installed on this machine), including evidence-chain tamper tests and executor isolation tests.
- `dev-missions.html`: **132** checks pass; `dev-demo-mode.html`: 88 checks pass; browser runner: **28/28** pages.
- macOS seatbelt execution was exercised on this machine. Linux bubblewrap is implemented but not exercised on real Linux here; Windows returns `unavailable`.
- Still not 9.8 and still not an external-attestation platform: external identity signatures, rollback-proof evidence, model price/cost accounting, multi-tenancy and bridge modularization remain.

## [1.25.0] - 2026-11-28

### Added
- **Cinematic real-mode transitions**: mission start, boss-approval pause and mission-complete now play a stage briefing with crew logos, task progress and a scanline overlay. The first demo load plays a Sprint 01 briefing with the product promise.
- **Live collaboration network**: real agents draw routed, animated data links to the whiteboard/meeting room/boss office, with flowing beads and status-coloured nodes; the current agent gets a moving floor spotlight.
- **Office ambience**: dust, light shafts, pendant lamps, monitor bloom, coffee steam, screen chart animation, whiteboard scanline, room-state pulses, a roaming cleaner robot and character-held props (laptop, paper, cup, tablet, warning badge, celebration sparks).
- **Real artifact diffs**: task runs now compute actual added/modified/removed files and line counts from previous artifacts, storing unified diff previews; Mission Control renders the evidence.
- **Opt-in sandboxed tests**: a task can run generated Python `unittest` suites under macOS `sandbox-exec` with network denied, home-directory reads denied and a temporary workspace. Exit code, duration and output are stored as evidence; it is never automatic and is not a general-purpose sandbox.
- **Task completion pulse**: completed tasks trigger a +N TASK stage pulse and a short lighting wash.
- **Positioning**: "看见 AI 团队，把事做完。" is used on the boot screen, topbar, real-mode cover and page title, with the proof line "谁在干 · 干到哪 · 交付了什么".
- **Next action**: when no mission is active, the real board shows a next-step card with the latest mission, progress, open/new-mission actions and an AI setup shortcut when needed.

### Changed
- Stage whiteboard and meeting screen now show real mission state; the wall clock follows local time in real mode.
- Delivery verification now clears stale evidence when a task is rerun, and attaches fresh evidence before the completion gate.
- The “重新交付” action is wired to the existing rerun endpoint and refreshes task evidence.

### Verified
- Python: 82 tests pass, including artifact-diff, verification-engine and sandbox-execution tests.
- `dev-missions.html`: 125 checks pass, including verification, diff and test-run UI.
- `dev-demo-mode.html`: 88 checks pass, including cinema, collaboration web, spotlight, ambience and completion states.
- Browser E2E runner: 28/28 `dev-*.html` pages pass.
- Still not a general sandboxed code-execution platform and not externally attested; the opt-in Python test sandbox is deliberately narrow.

## [1.24.0] - 2026-11-28

### Added
- **Positioning line**: the product now says what it is on first paint and in the topbar: **“看见 AI 团队，把事做完。”** (“Watch an AI team get work done.”), with the proof line “谁在干 · 干到哪 · 交付了什么”. The boot screen, real-mode cover and page title use the same promise.
- **Delivery verification**: `verification.py` produces local evidence for generated task files — existence, size, SHA-256, placeholder rejection, JSON parsing, Python compilation, JavaScript syntax (`node --check` or macOS JavaScriptCore), Shell (`bash -n`), HTML parsing and CSS brace checks. The result is shown in Mission Control and can be run on existing tasks with `POST /missions/<id>/tasks/<taskId>/verify`.
- **Honest completion gate**: auto-run now stops and blocks a task when verification fails; it never marks a task done with missing, empty, placeholder or syntactically invalid deliverables. Passed/presence-only tasks are labelled instead of being presented as fully verified.
- **Browser E2E runner**: `scripts/browser_suite.py` serves the repo, runs the `dev-*.html` pages in headless Chromium in parallel, parses PASS/CLEAN/TRACE/DEBUG results and returns a non-zero exit on failure. CI now runs a no-bridge smoke subset via `browser-actions/setup-chrome`.
- **Remote trust boundary**: non-loopback bridge binding is refused unless `BRIDGE_ALLOW_REMOTE=1` and `BRIDGE_TOKEN` are set. Remote clients must send the token; loopback keeps zero-config. Host/Origin gates remain. Optional `BRIDGE_TLS_CERT`/`BRIDGE_TLS_KEY` enables TLS 1.2+ for remote deployments.

### Fixed
- **“重新交付” button**: the UI called `rerunTask`, which did not exist. It now calls the existing `/missions/<id>/tasks/<taskId>/rerun` endpoint, shows progress/failure, and refreshes the task.
- **External provenance**: task verification panels explicitly label external-agent reports as self-reported until locally checked.
- **Trace honesty**: Trace Lab is labelled `DEMO TELEMETRY`.

### Verified
- Python: 78 tests pass, including 6 verification-engine tests and verification persistence/revision.
- `dev-missions.html`: 123 checks pass (verification UI/endpoint and rerun method included).
- `dev-demo-mode.html`: 83 checks pass (positioning line and real panel promise included).
- Browser E2E runner: all 28 `dev-*.html` pages pass; CI smoke subset passes with no bridge running.
- Delivery verification on the existing “实现与技术方案” task: 21 syntax checks passed, 3 runtime/presence checks skipped, 0 failed; the UI records hashes and the “tests not executed” limitation.

## [1.23.0] - 2026-11-27

### Added
- **Real business event feed**: `GET /missions/overview` now returns up to 60 real office events built from task status changes, approvals, deliverables, discussions and model calls. Deleted/archived missions are excluded. The real-mode LIVE FEED renders them with kind filters (全部/任务/交付/模型/审批), real timestamps, actors and deep links.
- **Real mission focus board**: an active mission now fills the REAL BOARD with 进行中 / 评审中 / 待开始 / 已完成 groups, assignees and per-task progress. Recent deliverables are listed below the mission list with direct Mission Control links.
- **Real office choreography**: external agents now share the demo character visual language (aura, ring, badge, nametag, logo, paper speech bubble, progress bar) and a full state machine: routed walking, work typing, review, coffee, group-message replies, whiteboard/deck checks, meeting seats, boss approvals, ship-it celebration and confetti.
- **Idle life**: when no mission is running, agents rotate between desk review, coffee, lounge, quiet corners and office patrol. Bubbles use real completed task titles, artifact names and delivery context instead of fabricated chat.
- **Live presence**: real mode shows a local LIVE clock, "可调度" instead of a dead "0 在线", full-brightness ready agents, and per-agent task/status in the team rail.

### Changed
- Real-mode stage whiteboard now shows the focused real mission, completion count, live day marker and progress instead of the demo scenario.
- The redundant stage note is suppressed once real missions exist; the topbar Real panel and Mission Center remain available.
- Real agent movement uses the same obstacle/hub path graph as the demo so characters route through aisles instead of walking through furniture.
- Real feed header is now LIVE FEED with a real-event subtitle; the demo-off clock pill is kept and shows local time.
- Version 1.23.0 cache-busts all CSS/JS assets.

### Verified
- `dev-demo-mode.html`: 80 checks, including real working bubble/progress, mission focus board, meeting speaker, waiting-boss state, celebration confetti and idle life.
- Python: 71 tests pass, including real activity feed extraction and archived-mission exclusion.
- Browser: all 28 `dev-*.html` pages pass (24 PASS, 2 CLEAN, trace and path debug).

## [1.22.0] - 2026-11-27

### Added
- **Token estimate plan**: new missions no longer ask for a token cap. The form shows the per-task estimate plan, and Mission Control’s Eval tab shows estimated input, output, total and per-task estimates.
- **Context insight**: each mission detail now reports base brief/acceptance chars, files and chars, memories, decisions, reports, estimated context tokens, estimated input/output and actual model-call tokens and latency.
- **Model call ledger**: every discussion, task, deliverable and chat model call is persisted with provider, model, mission/task/agent, prompt/system chars, context estimate, input/output tokens, latency, status and error. Existing task/discussion usage is backfilled once so the ledger is immediately useful.
- **Model calls UI**: a global panel (Settings rail, full drawer, command palette, and “查看模型调用明细” in Eval) with summary cards, mission/purpose filters, search, rows and expandable details.

### Changed
- Tasks are unlimited by design: the UI no longer sets or edits a token cap, the bridge ignores `tokenBudget` for new missions and auto-run no longer stops on a token budget. Actual usage remains fully visible.
- Added `usage.css`, `usage.js`, `dev-usage.html` and docs/USAGE.md.

## [1.21.1] - 2026-11-27

### Fixed
- **No more placeholder deliverables**: a task is never marked done when the model returns only “已完成任务并提交交付物” or another empty/placeholder text. The bridge asks the model once for the actual deliverable, and if that still fails the task stays unfinished with an actionable error instead of fabricating a 36-byte file.
- **Long deliverables no longer truncate into invalid JSON**: task and discussion calls now use larger prompt/output budgets and a balanced JSON extractor; failed structured output falls back to a focused deliverable request.
- **Usable files are persisted**: model output can include a `files` array or fenced `file:path` blocks; each file becomes a downloadable artifact linked to the task, and the report stores the deliverable text.
- **Task-level deliverable UI**: completed tasks show their files, a warning when a deliverable is missing or too short, a “重新交付” action, and the mission files tab can download every deliverable as one ZIP with a manifest.

### Added
- Regression tests for placeholder rejection and the repaired-report path.
- Focused deliverable generation for implementation/QA/release/risk work; implementation tasks can produce code, tests and scripts instead of a single summary.

## [1.21.0] - 2026-11-27

### Added
- **Company Memory**: persistent workspace and per-agent memory entries with titles, Markdown content, tags, pinning, search and scope filters. The bridge injects relevant memory into mission discussion, task execution and chat replies as reference material, never as instructions.
- **Universal search in the command palette**: Cmd/Ctrl+K now searches missions, tasks, conversations, messages, files, memories and agents in addition to static commands. Results are grouped, keyboard-selectable and deep-link to the exact mission, task, message, file or memory.
- **Memory manager UI**: a two-pane memory workspace opened from the command palette, Settings rail or the full drawer; create/edit/delete, two-step delete, pin, tags and workspace/agent scope.
- **Deep links**: search result tasks open the mission task drawer; message results open the conversation and scroll to the message.

### Changed
- Mission context packs and chat system prompts now include pinned/recent memory; empty memory costs nothing.
- Version 1.21.0 adds `memory.css`, `memory.js`, the memory modal and `dev-memory.html` (18 checks).

### Fixed
- Command-palette search cancels stale requests, groups remote results and keeps the static command list usable while remote results load.

## [1.20.0] - 2026-11-27

### Added
- **Signal Studio chat workspace**: a full visual and interaction redesign of the group/DM window — 1020×700 desktop surface, 300px conversation rail, ink-and-paper day palette, grouped pinned/recent/earlier conversations, online-team presence strip, channel header with member roles and a LIVE marker, and a refined details drawer.
- **Group messages at the top of the rail**: a dedicated 群消息 shortcut now sits above 工作, opens the chat workspace in group mode, and carries the total unread badge. 沟通 keeps new-group, DM and existing-group entry points and explains where group messages moved.
- **Composer quick actions**: 同步进度 / 请求拍板 / 上传文件 insert a useful draft or open the file picker without leaving the conversation; the send action now has a visible label and keyboard hint.
- **Conversation sections**: pinned, today's recent conversations and earlier threads are separated, with counts in the rail.

### Changed
- Chat styling moved into `chat-v2.css`, scoped to `.chat-hub.chat-v2`; the old CSS remains for compatibility with existing screenshots and settings.
- The workspace uses a mint-to-sky signal accent, 13px message text, larger conversation rows, softer message cards, a floating composer dock and a below-header details drawer.

### Fixed
- The chat composer now stays inside the window after the quick-action row was added.
- The details drawer starts below the channel header instead of covering its actions; the member section label is now “成员” rather than the form label.

## [1.19.1] - 2026-11-27

### Changed
- **Group creation moved to Communication**: the Create flyout now contains task creation only; group messages, new group and direct messages live under Communication, with a notice explaining the move.
- **Existing groups are visible in the rail**: Communication now lists built groups and task groups with their latest message and unread badge; selecting one opens the new chat workspace directly.
- **Mission Control uses the new workspace**: built group/DM rows, the “建群” and “私聊” header actions, and the new “聊天工作台” header action all open the ChatHub instead of the old inline group form or Mission chat. The header action opens the conversation list when no conversation is active.
- **No more old “NEW GROUP” modal from the UI**: the feature drawer, rail, Mission Control and mission header all route group creation into the ChatHub group form.
- **Composer stays inside the window**: constrained the ChatHub grid row so the message list shrinks instead of pushing the composer below the window edge; added a regression check (`dev-chat.html`, 60 checks).

### Added
- Regression coverage for the moved navigation, Communication group list, rail group creation, built-group routing, direct routing and Mission Control chat-workspace entry.

## [1.19.0] - 2026-11-27

### Added
- **Two-pane chat hub**: the group/DM popup is now a real messaging workspace with a conversation rail, unread badges, search, group/direct filters, pinned/muted chats, rename and delete actions, and a full-screen mobile sheet.
- **Unread and read state**: conversations persist `readSeq`; agent messages raise unread counts, opening a chat marks it read, muted conversations are excluded from the total, and the rail refreshes without reloading the page.
- **Rich messages**: safe Markdown (headings, lists, quotes, links, bold/italic, inline code), fenced code blocks with copy, date separators, sender grouping, delivery ticks, AI/provider badges, report cards with expandable detail, proposal/approval cards, and attachment previews.
- **Message actions**: copy, quote-reply, open the related mission, and jump-to-latest; quoted content is stored with the message.
- **Composer upgrades**: per-conversation drafts, auto-grow textarea, Enter-to-send / Shift+Enter newline, emoji picker, `@` member suggestions, drag/drop and paste uploads, file chips with upload state, and a character counter.
- **Conversation details panel**: member roles and presence, conversation metadata, task shortcut, and files from the current conversation.
- **Polished rename dialog** (no browser prompt), two-step delete confirmation, and a `Cmd/Ctrl+F` in-conversation search.
- **Mission Control text upgrades**: safe Markdown rendering, copy affordance on agent/boss messages and reports, and Enter-to-send composer behavior.

### Changed
- Chat typography and spacing are now Gemini-style: 12.5px message text, clear hierarchy, 8px rhythm, hover/focus/disabled states, light/dark palettes, focus trap, reduced-motion support, and a responsive 430px layout.
- The chat window is now 900×650 on desktop with a conversation rail, instead of the previous 360px bubble-only popup.
- Added `dev-chat.html` (59 checks) and expanded bridge coverage for unread/pin/mute/rename.

### Fixed
- Sending a message now clears the composer draft instead of restoring the sent text on re-render.
- Fast AI replies that arrive before the local pending state no longer leave a stuck typing indicator.
- The chat hub no longer relies on a full-screen picker step; the previous group/DM flow remains reachable from the rail and shortcuts.

## [1.18.5] - 2026-11-27

### Fixed
- **Floating chat** (the QQ/WeChat-style window) now shows “Agent 正在输入…” and refreshes the AI reply through its existing poll, not only Mission Control.
- Mission task groups can also receive AI member replies; the previous active-auto-run guard no longer suppresses them.
- Added a polling fallback for Mission Control chat replies in case the message SSE is unavailable.
- Mission Control's “Agent 正在输入…” state now survives auto-run reports and clears only for the actual chat reply; sending a chat message while reports arrive no longer drops the typing state or skips the reply wait.
- Update verification now allows 60 seconds for Python byte-compilation, so a slow or heavily loaded disk no longer rolls back a valid update.

### Changed
- Added regression coverage for mission-group chat during an active auto-run, and cleaned up test agents between bridge tests so full-suite results are deterministic.
- Version bumped to 1.18.5.

## [1.18.4] - 2026-11-27

### Added
- **Chat replies now actually work**: boss messages in direct chats and ad-hoc groups trigger a reply from a conversation member through the configured local AI provider. The reply is posted back through the same conversation/SSE channel.
- **Typing indicator**: the sender sees “Agent 正在输入…” while the reply is being generated, then the reply replaces it.
- **Offline-safe fallback**: if no provider is configured or the call fails, the agent posts a clear fallback instead of staying silent.
- **Bridge regression tests** for direct-chat and group-chat agent replies using the mock provider.

### Fixed
- Group and private chat previously only stored the boss message; no agent response path existed.

### Changed
- Version bumped to 1.18.4.

## [1.18.3] - 2026-11-27

### Fixed
- **Real-mode tasks now have visible office animation**: external agents are rendered as animated pixel characters at desks, the active mission agent gets a bright working animation, a task bubble and a progress bar, and idle agents walk between desks. No more empty/frozen real-mode stage.
- **Cache staleness**: added `serve.py` with `Cache-Control: no-store` and version query strings on CSS/JS, so a stale cached bundle cannot show an old note/PAUSED UI after an update.
- Fixed the real-agent sprite hash producing an undefined hair color (only one agent rendered).
- Real external agents are refreshed into the office on external-agent updates, not only on the next mission poll.

### Changed
- Version bumped to 1.18.3.

## [1.18.2] - 2026-11-27

### Fixed
- **Turning demo off no longer traps the workspace behind a full-screen REAL OPS cover**. It now lands directly in the real workspace with the compact dismissible “真实运营模式” card; the topbar **真实模式面板** button opens the detailed panel when needed.
- Updated demo-mode and guide self-checks for the non-blocking transition.

### Changed
- Version bumped to 1.18.2.

## [1.18.1] - 2026-11-27

### Fixed
- **Stale local install made the left feature rail unstyled**: AgentOffice.app runs `$HOME/agent-office`, which was still a partial 1.7-era copy without `features.css` / `demo-mode.css`. The repo was verified, but the actual installed app was not. The installed copy is now synced to 1.18.1 and the running bridge restarted with the current code.
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
