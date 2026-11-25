# Event Protocol

## Agent identity

```json
{
  "id": "ext-a1b2c3d4",
  "name": "Claude Code · Remote",
  "runtime": "deepseek",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "endpoint": "https://api.deepseek.com/v1",
  "skills": ["chat", "coding", "reasoning"],
  "note": "external agent",
  "status": "online"
}
```

## Heartbeat

```http
POST /agents/<id>/heartbeat
Content-Type: application/json

{"note":"alive"}
```

An agent is online for 40 seconds after its last heartbeat (demo agents follow the demo flag).

## Event

```json
{
  "agentId": "ext-a1b2c3d4",
  "kind": "skill",
  "action": "modify hero empty state",
  "taskId": "t4",
  "skill": "react",
  "tool": "edit",
  "file": "src/components/Hero.tsx",
  "line": [1, 142],
  "add": 8,
  "del": 3,
  "note": "external agent event",
  "tokensIn": 980,
  "tokensOut": 510,
  "cost": 0.010,
  "durationMs": 2100,
  "model": "deepseek-chat",
  "provider": "deepseek"
}
```

```http
POST /events
Content-Type: application/json
```

The bridge adds `id`, `ts`, `agentName`, `runtime`, `provider` (when known) and `external: true`.

## Mapping into Agent Office

`external.js` polls `GET /events?since=N` and calls `engine.ingestExternalEvent()`. The event is appended to `world.ledger` with:

- `external: true`
- `externalId: "ext:<bridge-event-id>"` for dedupe
- `agentName`, `runtime`
- `provider` when the event came from a model API adapter
- supplied token/cost/duration/model fields

It is then visible in:

- Live Feed (`work` message + ledger filter)
- Trace Lab (`EXT` filter, external span detail)
- task trace when `taskId` matches
- OTLP export (`agentops.external=true`, `gen_ai.agent.name`, usage attributes)

## Current boundary

External events do **not** change `task.status`, `task.progress` or checks. They are evidence/observability only. A future protocol can add explicit task commands with validation and an approval path.

## OTLP

`engine.otlp()` emits `resourceSpans[].scopeSpans[].spans[]` with:

- `gen_ai.operation.name`
- `gen_ai.agent.name` / `gen_ai.agent.id`
- `gen_ai.request.model`
- `gen_ai.usage.input_tokens` / `output_tokens` / `total_tokens` / `cost_usd`
- `gen_ai.tool.name`, `gen_ai.skill.name`
- `code.filepath`, `code.lineno`, `code.lines.added`, `code.lines.removed`
- `openinference.span.kind`
- `agentops.external`, `agentops.runtime`, `agentops.provider`, `agentops.event.kind`, `agentops.event.status`

## Assignment events

A delegated task produces normal external events:

- `handoff` — created by `POST /assignments`
- `skill` — progress updates from `PATCH /assignments/<id>`
- `complete` — completion with `result` and `evidence`
- `risk` — failure or cancellation

The browser mirrors the bridge assignment into `task.status`, `task.progress`,
`task.externalName`, `task.externalAssignmentId`, `task.externalResult` and
`task.externalEvidence`. A completed external task is marked `done` but its
unverified checks are finalized as risk/missed. See
[TASK_DELEGATION.md](TASK_DELEGATION.md).

## Model API adapter

`POST /providers/<id>/run` makes one model call and then emits a normal external
event:

```json
{
  "kind": "skill",
  "skill": "model-call",
  "tool": "deepseek",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "tokensIn": 42,
  "tokensOut": 18,
  "durationMs": 1300
}
```

The response text is stored in `action` (truncated) and `note` (up to 500
characters). This is still observability-only: it does not claim or complete a
simulation task. See [PROVIDERS.md](PROVIDERS.md).
