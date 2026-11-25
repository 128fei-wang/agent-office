# Mission Control

Mission Control is the task workspace on top of Agent Office:

- create a task with a description, acceptance criteria, priority, deadline and files;
- open a task group, ad-hoc group or one-to-one DM;
- upload documents, spreadsheets, PDFs and images;
- optionally recognize image text with a vision model or `tesseract`;
- auto-select a team, decompose the task and assign every member by skill;
- keep every agent covered with a primary or standby task;
- require structured reports with a solution;
- route only four kinds of decisions to the boss;
- keep decisions, approvals, files and reports in one auditable thread.

Open **任务 / TASKS** in the top bar or use `?missions=1`.

![Mission Control](screenshots/missions.jpg)

## Task charter

Every mission freezes a charter on creation:

| Field | Meaning |
| --- | --- |
| objective | what the task must achieve |
| acceptance | what counts as done |
| deadline | optional target date |
| budget | optional; a positive budget creates a spend approval |
| non-goals / constraints | scope guardrails |
| boss gates | spend, decision, login, authorization |
| decision rule | the team decides technical topics; the boss only decides the four gates |
| report format | done / next / risks / solution / evidence |
| communication | task group for decisions; DMs for clarification |

The charter and task rules are written into the task group as a system message,
so every member sees the same contract. The current version is frozen at v1;
scope/budget changes should be treated as a new decision and approval.

## Only four things need the boss

`missions.py` rejects any other boss gate:

```text
spend          amount, currency, vendor/purpose
decision       business final call, with options and a recommendation
login          QR login / service login request
authorization  scopes, resource, duration
```

Technical architecture, tools, dependencies, schedules, testing, copy and design
tradeoffs are team decisions. If an agent tries to escalate a technical issue,
the bridge returns `technical_issue_must_be_solved` and leaves the report
unaccepted.

Approval rules:

- a request is one-time and cannot be silently re-approved;
- no auto-approval on timeout;
- the boss sees the amount/options/scopes/service and the evidence;
- QR login is an attachment plus a service request; credentials are never
  stored in chat;
- a rejected approval blocks the linked task until a new route is proposed.

## Automatic team and assignment

The bridge builds a directory from:

1. company role slots when a one-person company exists;
2. built-in AI roles otherwise;
3. connected external agents (`Codex`, `WorkBuddy`, etc.).

Team selection prefers the roles needed by the task (product, design, engineer,
QA, growth, chief) and adds copy/video or external workers when relevant.
Assignment is deterministic:

```text
skill overlap × 10
+ role match × 8
+ external worker bonus
− current load × 4
```

Each task records its `assignmentReason`. After primary assignment, any member
with zero work receives a useful standby task: risk review, evidence check,
acceptance matrix, dependency watch or environment preflight. "No idle" means
**no agent is left without a concrete, useful next action** — not that agents
send fake activity.

## Task states

```text
queued → assigned → in_progress → review → done
                         ↘ blocked
```

- Dependencies point at task IDs and are promoted automatically when all
  dependencies are done.
- Reports move a task to `review`.
- QA/owner verification can move it to `done` with `PATCH /mission-tasks/<id>`.
- A technical blocker must include a solution or fallback; otherwise the report
  is rejected.

## Reports

A report is a structured object, not free text:

```json
{
  "summary": "what happened",
  "done": ["..."],
  "next": ["..."],
  "risks": ["..."],
  "solution": "how the team handled the risk or blocker",
  "evidence": ["file or test"],
  "needsBoss": ["spend"],
  "approval": {
    "type": "spend",
    "title": "First ad test",
    "amount": 800,
    "currency": "CNY"
  }
}
```

The bridge rejects a report without a solution or with a non-boss gate. Reports
render as cards with separate done / next / risks / solution / evidence fields.

## Chat

- **Task group**: created automatically for every mission.
- **Group chat**: ad-hoc group with any selected members.
- **DM**: one-to-one with an agent.
- **Messages**: text, attachments, proposals, reports, approvals and system
  records. SSE against `/missions/stream?since=N` gives live updates.
- **Files**: document and image attachments are stored outside the static app
  and served through `/files/<id>/raw`.
- **Private** means a separate conversation and membership check; it is not a
  UI-only filter. The boss can open a DM from a member card or a task owner.

## Files, documents and images

Upload types include text, Markdown, CSV, JSON, HTML, DOCX, XLSX, PDF, images and
other files.

Extraction:

| Type | Extraction |
| --- | --- |
| text / markdown / csv / json | read directly |
| HTML | strip tags |
| DOCX | `word/document.xml` via stdlib zipfile |
| XLSX | shared strings via stdlib zipfile |
| PDF | optional `pdftotext` |
| DOC | optional macOS `textutil` |
| images | on-demand vision provider, macOS Vision (`ocr_vision.swift`), or optional `tesseract` |

Image recognition is **on demand**:

```text
POST /files/<id>/vision
```

The bridge tries a configured vision-capable model provider first (Gemini,
OpenAI/OpenAI-compatible, Anthropic); on macOS it then uses the system Vision
framework (`ocr_vision.swift`), and falls back to `tesseract` when installed. If
none is available, the UI shows a clear "vision unavailable" message. OCR text
is stored with the artifact and rendered in the file preview. macOS Vision was
verified locally without any API key.

Attachments are untrusted. They are **data**, not instructions; do not let an
uploaded document redirect an agent's policy.

## AI discussion and AI execution

- **AI discussion** sends the charter, rules, members and tasks to one
  configured model API. It posts role-specific discussion, proposals, technical
  decisions and optional valid boss approvals. It never invents a technical
  escalation.
- An **unreachable local provider is skipped**; if no model service is
  available, the rule-based plan remains and the group shows a clear notice.
- **AI run** on a virtual role task asks the configured provider for a concrete
  deliverable and a structured report. The deliverable is saved as a Markdown
  artifact, the task moves to review, and the report appears in the group.
- External workers use the task protocol instead (below); they are not
  impersonated by the AI run button.

## API

```text
GET    /missions
GET    /missions/overview
GET    /missions/agents
POST   /missions
GET    /missions/<id>
DELETE /missions/<id>
POST   /missions/<id>/discuss
POST   /missions/<id>/tasks/<taskId>/run
PATCH  /mission-tasks/<id>
GET    /mission-tasks?agentId=<id>

GET    /conversations?missionId=&kind=
POST   /conversations
GET    /conversations/<id>
GET    /conversations/<id>/messages?since=
POST   /conversations/<id>/messages

GET    /approvals?status=pending
POST   /approvals
POST   /approvals/<id>/resolve

POST   /files
GET    /files
GET    /files/<id>
GET    /files/<id>/raw
POST   /files/<id>/vision

GET    /missions/stream?since=N
```

### External worker protocol

An external agent pulls its tasks:

```bash
curl "http://127.0.0.1:8787/mission-tasks?agentId=ext-my-agent"
```

It reports a result:

```bash
curl -X PATCH http://127.0.0.1:8787/mission-tasks/<task-id> \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId": "ext-my-agent",
    "status": "review",
    "report": {
      "summary": "Implemented the form and validated mobile",
      "done": ["form", "responsive states"],
      "next": ["QA review"],
      "risks": ["third-party form endpoint"],
      "solution": "added a local fallback endpoint and retry",
      "evidence": ["tests/12-passed"],
      "needsBoss": []
    }
  }'
```

## Data and security

- Mission data: `~/.agent-office/missions.json`
- Uploads: `~/.agent-office/uploads/`
- Files are served by the bridge, not the static server.
- The bridge remains localhost-only with Host/Origin checks. There is no user
  authentication; use it on a trusted machine.
- Uploads are capped at 25MB; manual update archives are capped at 80MB.
- Raster images are inline; SVG/PDF/other documents are attachments.
- The boss approval endpoint is local-only. A production multi-user deployment
  needs real identity/auth and server-side role checks.

## Research references

These projects informed the patterns; no code or runtime was copied:

| Project | Pattern adopted |
| --- | --- |
| [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer) | task/session/review workspace, async approval lineage |
| [loopx-project/loopx](https://github.com/loopx-project/loopx) | owner/safety/publication gates, evidence and leases |
| [builderz-labs/mission-control](https://github.com/builderz-labs/mission-control) | inbox → assigned → review → done, atomic queue and approvals |
| [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) | durable human interrupt / resume cards |
| [temporalio/temporal](https://github.com/temporalio/temporal) | durable workflows, signals and waiting without compute |
| [open-policy-agent/opa](https://github.com/open-policy-agent/opa) | versioned policy gate table |
| [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) | role/task abstraction and human feedback |
| [mattermost/mattermost](https://github.com/mattermost/mattermost) | channels/threads/DMs and agent mentions |
| [zulip/zulip](https://github.com/zulip/zulip) | topic-scoped async discussions and read state |
| [chatwoot/chatwoot](https://github.com/chatwoot/chatwoot) | conversation inbox, assignment and capacity |
| [makeplane/plane](https://github.com/makeplane/plane) | work-item states, intake triage and templates |
| [docling-project/docling](https://github.com/docling-project/docling) | document layout/table/OCR pipeline ideas |
| [microsoft/markitdown](https://github.com/microsoft/markitdown) | files-to-Markdown conversion approach |
| [tesseract-ocr/tesseract](https://github.com/tesseract-ocr/tesseract) | optional CLI OCR fallback |
| [adr/madr](https://github.com/adr/madr) | decision record template |

We deliberately did not embed LangGraph, Temporal, OPA, CrewAI, docling or a
full chat server. The product stays zero-dependency and local-first; these
projects supplied workflow and UX patterns.

## Limits

- AI discussion and AI run need a reachable provider. Local WorkBuddy/Ollama
  gateways are probed; if neither is running, the rule plan still works.
- PDF text extraction needs `pdftotext`; image OCR needs a vision provider,
  macOS Vision, or `tesseract`. There is no bundled cross-platform OCR model.
- QR login is a boss approval gate for an agent-supplied QR/link; Agent Office
  does not implement each service's OAuth flow.
- Approvals are local and unauthenticated; this is not a multi-tenant approvals
  service.
- Standby tasks are real, bounded checks, not simulated busywork.
- Mission data lives in a JSON document; large deployments should move to
  SQLite/Postgres.
