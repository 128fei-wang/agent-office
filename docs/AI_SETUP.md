# AI setup and auto-run

Agent Office connects a model service in three steps and can then run a mission
end to end. The goal is zero manual JSON editing for normal use; the config file
remains available as an advanced fallback.

## Why the app said "AI unavailable" with credentials present

The bridge only recognised `ANTHROPIC_API_KEY`. A machine configured by a
Claude-compatible gateway often exports `ANTHROPIC_AUTH_TOKEN` and
`ANTHROPIC_BASE_URL` instead, so the credentials existed but were ignored.

The bridge now recognises:

| Provider | API key env | Base URL env | Model env |
| --- | --- | --- | --- |
| Claude | `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` | `AGENT_OFFICE_ANTHROPIC_BASE_URL`, `ANTHROPIC_BASE_URL` | `AGENT_OFFICE_ANTHROPIC_MODEL`, `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL` |
| OpenAI | `OPENAI_API_KEY` | `AGENT_OFFICE_OPENAI_BASE_URL`, `OPENAI_BASE_URL`, `OPENAI_API_BASE` | `AGENT_OFFICE_OPENAI_MODEL`, `OPENAI_MODEL` |
| DeepSeek | `DEEPSEEK_API_KEY` | `AGENT_OFFICE_DEEPSEEK_BASE_URL`, `DEEPSEEK_BASE_URL` | `AGENT_OFFICE_DEEPSEEK_MODEL`, `DEEPSEEK_MODEL` |
| Gemini | `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENAI_API_KEY` | `AGENT_OFFICE_GEMINI_BASE_URL`, `GEMINI_BASE_URL` | `AGENT_OFFICE_GEMINI_MODEL`, `GEMINI_MODEL` |
| Ollama | `OLLAMA_API_KEY` (optional) | `AGENT_OFFICE_OLLAMA_BASE_URL`, `OLLAMA_BASE_URL` | `AGENT_OFFICE_OLLAMA_MODEL`, `OLLAMA_MODEL` |

The UI marks these as **detected locally** and never sends the key to the page.

## The three steps

Open **Tools → AI model service → Connect AI in 3 steps**, or the same action in
Mission Control.

1. **Service** — pick a provider card. Detected local credentials and configured
   providers sort first. Local providers show whether the gateway is actually
   online.
2. **Connect** — reuse the detected environment, paste an API key, or edit the
   model and advanced base URL. The key field can stay blank when a key is
   already saved.
3. **Test & enable** — the bridge performs a real minimal model call. Only after
   it succeeds is the config written to `~/.agent-office/providers.json`; a
   failed test never overwrites an existing config.

Advanced config remains behind a disclosure, not on the main path.

## Full auto-run

Mission creation has one option:

> Run automatically after creation (discuss → assign → execute → report)

When enabled and a model is available, the bridge background worker:

1. runs the AI discussion if it is enabled;
2. finds dependency-ready tasks;
3. executes each task with the model while keeping the assigned agent identity;
4. writes the report and Markdown deliverable;
5. auto-verifies the report, promotes dependent tasks, and continues.

Only a real boss gate pauses the run: spend, decision, login or authorization.
Approving the gate resumes the worker automatically. A malformed model approval
(for example `authorization` without scopes) is dropped, recorded as a risk, and
the agent continues on its fallback path instead of stopping the mission.

The model is the execution engine; task ownership remains with the assigned
Agent. External Agents still keep their names, reports and audit trail.

Existing missions get an **AI auto-run** card in the mission overview with a
**Run automatically** button. It can resume from current progress. The same card
has a **Stop** action; stopping keeps completed reports and deliverables.

## Mission status bar

Every mission shows a persistent command bar above the chat, on every detail tab:

```text
1 Discuss  →  2 Approvals  →  3 Execute  →  4 Report
Next · You need to act
Plan ready: 7 tasks waiting. First up: requirements review.
[Start 7 tasks] [View plan]
```

- If no plan exists, the action is **Discuss & run**; the bridge discusses first,
  then starts execution in the same click.
- If the discussion is complete but execution has not started, the action is
  **Start N tasks**. This is the case for missions created before auto-run was
  enabled.
- If approvals are pending, the bar says so and takes you to the approval cards.
- While running, the bar shows the current task and offers **Stop**; the label
  says **No action needed**.
- When finished, it shows **All tasks complete** and links to the plan/reports.

The bar is intentionally the single run control. The overview auto-run card is
informational, so users do not have to hunt through tabs to find the next step.

## Homepage office activity

Mission Control is not a separate window from the office. While an auto-run is
active, the home page shows:

- a **MISSION LIVE** HUD with mission, current task, agent, progress and whether
  the founder needs to act;
- the executing external agent's brand logo as a floating card at a hot desk;
- an animated task bubble and aura on the matching local role character;
- a highlighted team card with `任务执行中 · <task>` and the task progress.

The office HUD is read-only; the **Open mission** button jumps back to the
mission command bar. This makes automation visible without opening Mission
Control.

## External agent logos

Known external agent brands are mapped to bundled SVG assets under
`assets/logos/`:

| Brand | Asset |
| --- | --- |
| Codex | `codex.svg` |
| Claude | `claude.svg` |
| WorkBuddy | `workbuddy.svg` |
| Gemini | `gemini.svg` |
| DeepSeek | `deepseek.svg` |
| Doubao | `doubao.svg` |
| Kimi | `kimi.svg` |
| Qwen | `qwen.svg` |
| Ollama | `ollama.svg` |
| OpenAI | `openai.svg` |

Avatars set to auto detect the logo; preset avatars and custom initials still
override it. An external agent may also provide a safe `logoUrl` (bundled path
or HTTPS URL). If an image fails to load, the original initials are used.

## Security

- Keys are written only to `~/.agent-office/providers.json` with mode `0600`
  (the directory uses `0700`).
- Keys never enter browser storage, task records, logs, exports or the repo.
- The bridge stays bound to localhost.
- The test request is made by the bridge, not the browser.
- The file remains the only manual fallback; advanced users can still set
  environment variables.

## Reference patterns reviewed

| Project | Pattern adopted | What we did not copy |
| --- | --- | --- |
| [langgenius/dify](https://github.com/langgenius/dify) | provider cards, add key, credentials validated before the provider becomes available | large marketplace/plugin surface |
| [open-webui/open-webui](https://github.com/open-webui/open-webui) | add connection + explicit verify; local gateways shown next to cloud | admin-heavy connection list |
| [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | Basic vs Advanced model settings; provider connection reused across profiles | separate model-profile management |
| [LibreChat-AI/LibreChat](https://github.com/LibreChat-AI/LibreChat) | multi-provider support and model list | multi-file YAML/env/Compose setup as the primary path |

The common successful pattern is: choose a known provider, enter only the
credential, test before save, and hide endpoint/model details under Advanced.

## API

- `GET /providers` — public provider catalog, source (`file` / `environment`),
  local readiness, no keys.
- `POST /providers/<id>/configure` — `{ apiKey?, baseUrl?, model?,
  useEnvironment?: true }`; validates, tests, then saves atomically.
- `POST /providers/<id>/test` — test an already saved provider.
- `POST /missions/<id>/autorun` — start or resume auto-run. Send `{ "discuss": true }` to discuss first.
- `POST /missions/<id>/autorun/stop` — stop at the next safe point; completed work is kept.
- `POST /approvals/<id>/resolve` — resolving a pending gate also resumes a
  paused auto-run.

## Limits

- The model must return structured JSON for reports. A malformed report still
  fails that task; the mission card shows the error and lets you resume.
- Auto-run is sequential to keep dependencies and provider rate limits
  predictable.
- It is not a code execution sandbox. A deliverable is a stored Markdown artifact
  plus the report; actual repository changes still need an external Agent or a
  tool-enabled runtime.
