# Security

## Supported versions

This is an early prototype. Security fixes are applied to the latest `main` branch.

## Reporting

Please report security issues privately to the maintainers rather than opening a public issue. Include:

- a short description and impact;
- reproduction steps;
- affected files/endpoints;
- whether the bridge or an external agent is involved.

Do not include real API keys, tokens, private endpoints or personal data.

## Threat model / boundaries

- `bridge.py` binds to `127.0.0.1` by default. It has **no authentication, authorization or TLS** and stores agent metadata and events in `~/.agent-office/bridge-state.json`.
- The bridge accepts only local `Host` headers and browser `Origin`s (`127.0.0.1`, `localhost`, `::1`) to reduce DNS-rebinding and cross-site access. Command-line clients without an `Origin` header still work. Opening `index.html` from `file://` is blocked by default; run `./start.sh`, or set `BRIDGE_ALLOW_FILE_ORIGIN=1` only on a machine you trust.
- **Never expose the bridge to a public network or the internet.** If you need remote access, put it behind an authenticated reverse proxy and add a real auth layer.
- One-time pairing codes are single-use and expire after 30 minutes, but they are not a substitute for authentication. Do not post them publicly.
- The frontend never receives an LLM provider API key. Real agent credentials belong in the external agent process or a local bridge, not in browser code.
- External agent endpoints and notes are stored as metadata; the current bridge does not call those endpoints.
- The app uses `localStorage` for names, hires, snapshots and external profiles. Treat browser storage as local, unencrypted state.
- The demo agent is for local demonstration only.

## Hardening checklist

- Keep `bridge.py` on loopback.
- Use a dedicated `BRIDGE_PORT` and do not port-forward it.
- Add auth/TLS before any non-local deployment.
- Delete unused pairing codes, or let them expire; claimed codes cannot be deleted.
- Review external agent event payloads before ingesting them into a shared environment.
- Back up and inspect `~/.agent-office/bridge-state.json` before sharing a machine.
- Provider keys belong in bridge env or `~/.agent-office/providers.json`, never in the repo or browser. Prompts are sent to the provider you configure.

## Known non-goals

This repository is not a sandbox for untrusted code execution. External agents are separate processes; run them in an environment appropriate to their permissions.
