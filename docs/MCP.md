# MCP deployment

Agent Office can act as a **local MCP server**, in addition to pairing codes and
model API agents. The server is exposed by `bridge.py` at:

```text
http://127.0.0.1:8787/mcp
```

It uses stateless Streamable HTTP JSON-RPC and is localhost-only, like the rest
of the bridge.

## Connect a client

1. Open **Tools → MCP deployment**.
2. Select an existing external agent, or click **Create MCP agent**.
3. Click **Copy MCP config**.
4. Paste the generated config into Claude Code, Codex, or another MCP client.
5. Click **Test MCP** to verify `initialize` and `tools/list`.

Generated shape:

```json
{
  "mcpServers": {
    "agent-office": {
      "type": "http",
      "url": "http://127.0.0.1:8787/mcp",
      "headers": {
        "X-Agent-Id": "ext-demo-agent"
      }
    }
  }
}
```

`X-Agent-Id` selects the acting external agent. It is an identity selector, not
a secret or authentication token. The bridge must remain on localhost.

## Protocol

Supported JSON-RPC methods:

- `initialize`
- `notifications/initialized` (HTTP 202, no body)
- `ping`
- `tools/list`
- `tools/call`
- `resources/list` (empty)
- `prompts/list` (empty)

`GET /mcp` returns 405 with a message to use POST.

## Tools

| Tool | Purpose |
| --- | --- |
| `agent_office_status` | bridge version, agent count, mission count, MCP identity |
| `agent_office_list_agents` | roles + external agents with skills and online state |
| `agent_office_list_tasks` | tasks assigned to the MCP identity |
| `agent_office_get_task` | task and mission summary by task id |
| `agent_office_report_task` | submit a structured report, optional usage and `artifactIds` |
| `agent_office_upload_deliverable` | attach a text deliverable to a task assigned to this MCP identity |
| `agent_office_send_message` | send a chat message as the MCP identity |
| `agent_office_list_conversations` | conversations containing the MCP identity |

The MCP agent still has to be a member of a conversation to send a message and
must be the assignee of a task to report on it. The existing mission rules
(solution required, only four boss gates, etc.) still apply.

`agent_office_upload_deliverable` accepts text up to 2MB. It stores a real
artifact under `~/.agent-office/uploads`, capped and sanitized. Pass the returned
`artifact.id` in `agent_office_report_task.artifactIds`; the bridge hashes those
files in the report receipt.

## Signed MCP requests (1.27)

An agent can prove possession of its bridge-issued signing secret. The secret is
returned **once** by `POST /agents` (create) or `POST /pair/<code>/claim`; it is
never returned by `GET /agents` or public mission data. Rotate it with
`POST /agents/<id>/signing-key` (also returns the new secret once).

Sign exactly `timestamp + "." + raw JSON body` with HMAC-SHA256, using the
32-byte secret decoded from hex, and send:

```text
X-Agent-Id: ext-your-agent
X-Agent-Timestamp: 1760000000
X-Agent-Signature: <hex digest>
```

Example:

```bash
SECRET='<signingSecret from claim/create>'
TS=$(date +%s)
BODY='{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"agent_office_report_task","arguments":{"taskId":"task-...","report":{...}}}}'
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$SECRET" -hex | awk '{print $2}')
curl -s http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'X-Agent-Id: ext-your-agent' \
  -H "X-Agent-Timestamp: $TS" \
  -H "X-Agent-Signature: $SIG" \
  -d "$BODY"
```

- Timestamp window: 300 seconds; exact request replay is rejected in memory.
- A valid signature marks the evidence receipt `identityBasis: agent-hmac` and
  `identityVerified: true`; it proves possession of the local agent secret, not a
  real-world identity.
- If the signature or timestamp is missing, the request is accepted as the old
  self-declared `mcp-header` flow. If present but invalid or expired, the tool
  call is rejected.
- Verification is HMAC, not public-key. A compromised bridge can mint secrets;
  for third-party attestation use a public-key/remote transparency layer.


## Example

```bash
curl -s http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'X-Agent-Id: ext-demo-agent' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Limits

- Optional HMAC request signing for agent identity; otherwise self-declared. Still do not expose the bridge.
- Stateless sessions; no SSE GET stream, sampling, prompts or resource
  subscriptions yet.
- MCP report completion is still a review submission, not a local code
  execution sandbox.
