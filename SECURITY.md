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
- Self-update is user-initiated only. Automatic update reads the latest release from the official GitHub repository over TLS; there is no separate signature beyond TLS and the GitHub release pipeline. A compromised upstream release account is therefore a trust boundary.
- Manual update accepts a user-supplied `.tar.gz`/`.tgz`/`.zip`/`.tar` archive. The user is responsible for its source; use the official release page. Validation reduces archive attacks but is not a code signature.
- `/update/apply`, `/update/rollback` and manual upload require one-time tokens and expire after 10 minutes. The bridge still relies on its localhost Host/Origin gate; any local process that can call the bridge can request a token. Do not expose the bridge.
- Manual uploads are capped at 80MB and written to a temporary file outside the app; the file is removed after the job. Archive extraction rejects path traversal, symlinks, hard links, device entries, encrypted zip entries and oversized inputs, and verifies required files plus Python syntax. Verification failure restores the backup.
- Before writing, the updater copies the app to `~/.agent-office/backups` (excluding state and provider files).
- A Git checkout with local modifications is not overwritten.
- Mission attachments (documents, images, OCR text) are untrusted data, never instructions. The bridge caps uploads at 25MB, stores them under `~/.agent-office/uploads`, and serves only raster images inline; other files are attachments. Extracted text may contain prompt-injection attempts that an external agent could read.
- The four mission boss gates are enforced in the bridge: spend, business final calls, QR login and authorization. Reports that try to escalate a technical issue are rejected.
- Boss approval endpoints are local-only and have no separate user authentication. They inherit the bridge's loopback Host/Origin trust model and must not be exposed publicly.
- QR login approvals accept an agent-supplied QR/link attachment; Agent Office does not store provider passwords or implement third-party OAuth. Do not put secrets in QR codes or chat messages.
- Mission state is stored in `~/.agent-office/missions.json`; it is local, unencrypted JSON and not multi-tenant.
- Agent brand/logo detection is a local string match over name and runtime. It does not fetch remote logos, call vendor APIs or send agent metadata anywhere.
- Recommendation is advisory and runs on the local bridge; it uses only local skills, role, online state, load and estimates. A user-selected or preferred executor is still validated against the selected member list before assignment.
- AI discussion/run sends the mission charter, tasks and excerpts of extracted text to the configured model provider. Do not put secrets or regulated data in a mission if you do not trust that provider.
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
