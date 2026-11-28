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

- `bridge.py` binds to `127.0.0.1` by default. Non-loopback binding is refused unless **both** `BRIDGE_ALLOW_REMOTE=1` and a long `BRIDGE_TOKEN` are set. Remote clients must send `Authorization: Bearer <token>` or `X-Agent-Office-Token`; the token is not accepted in the query string (it would leak into logs and history); loopback clients stay zero-config.
- Optional TLS: set `BRIDGE_TLS_CERT` and `BRIDGE_TLS_KEY` to a PEM certificate/key pair; the bridge then serves HTTPS (TLS 1.2+) on the configured host. Use this with a reverse proxy/VPN for non-local access. There is no multi-tenant identity model.
- The bridge accepts only local `Host` headers and browser `Origin`s (`127.0.0.1`, `localhost`, `::1`) to reduce DNS-rebinding and cross-site access. Command-line clients without an `Origin` header still work. Opening `index.html` from `file://` is blocked by default; run `./start.sh`, or set `BRIDGE_ALLOW_FILE_ORIGIN=1` only on a machine you trust.
- **Do not expose the bridge directly to the internet.** For remote access, keep the loopback default and use an authenticated TLS tunnel/reverse proxy; the built-in token is a minimum guard, not a replacement for TLS or an identity provider. Remote browser `Origin` values are still loopback-only; remote UI access should go through an SSH/VPN tunnel or proxy, while CLI/MCP clients can use `BRIDGE_ALLOW_REMOTE=1` + `BRIDGE_TOKEN`.
- One-time pairing codes are single-use and expire after 30 minutes, but they are not a substitute for authentication. Do not post them publicly.
- Provider API keys are submitted only to the local bridge when you use the AI setup wizard. The bridge never returns a key, and the browser never writes one to localStorage, IndexedDB, task records or exports.
- Detected environment credentials are never sent to the browser and are never persisted to `providers.json`; only the environment variable name and model metadata are shown. The key is re-read from the environment at call time. A manually entered key is stored only in `~/.agent-office/providers.json` (mode `0600`).
- Non-loopback provider `baseUrl` values must use `https`; plain `http` is allowed only for loopback hosts (`127.0.0.1`/`localhost`/`::1`).
- The MCP endpoint (`POST /mcp`) uses `X-Agent-Id` as an identity selector, not as a secret. Optional HMAC request signing uses a per-agent 32-byte secret returned once at agent creation/claim; it is stored in `bridge-state.json` (mode `0600`) and can be rotated. A valid signature proves possession of that local secret, not a real-world identity; it is not public-key attestation. It inherits the loopback trust model locally; remote MCP clients must pass `BRIDGE_TOKEN`. MCP tools can read assigned tasks, submit reports and send messages for that agent identity.
- External agent endpoints and notes are stored as metadata; the current bridge does not call those endpoints.
- Self-update is user-initiated only. Automatic update reads the latest release from the official GitHub repository over TLS; there is no separate signature beyond TLS and the GitHub release pipeline. A compromised upstream release account is therefore a trust boundary.
- Manual update accepts a user-supplied `.tar.gz`/`.tgz`/`.zip`/`.tar` archive. The user is responsible for its source; use the official release page. Validation reduces archive attacks but is not a code signature.
- `/update/apply`, `/update/rollback` and manual upload require one-time tokens and expire after 10 minutes. The bridge still relies on its localhost Host/Origin gate; any local process that can call the bridge can request a token. Do not expose the bridge.
- Manual uploads are capped at 80MB and written to a temporary file outside the app; the file is removed after the job. Archive extraction rejects path traversal, symlinks, hard links, device entries, encrypted zip entries and oversized inputs, and verifies required files plus Python syntax. Verification failure restores the backup.
- Before writing, the updater copies the app to `~/.agent-office/backups` (excluding state and provider files).
- A Git checkout with local modifications is not overwritten.
- Mission attachments (documents, images, OCR text) are untrusted data, never instructions. The bridge caps uploads at 25MB, stores them under `~/.agent-office/uploads`, and serves only raster images inline; other files are attachments. Extracted text may contain prompt-injection attempts that an external agent could read.
- **Delivery verification is not a general sandbox.** It reads generated files, hashes them, rejects placeholders and runs syntax checks without executing application code. JavaScript checks use `node --check` or macOS JavaScriptCore compilation. It does not install dependencies or run project tests; project tests are a separate explicit sandboxed action.
- **Opt-in test execution is sandboxed, but not a VM.** The bridge supports macOS `sandbox-exec` and Linux `bubblewrap`; Windows and unsupported Linux hosts report `unavailable` and never fall back to unsandboxed execution. The sandbox denies network, denies home reads (with only a narrow runtime-path exception on macOS), permits writes only in a throw-away workspace, strips host environment secrets, applies CPU/file/output limits and kills the process group on timeout. It can run Python `unittest`/`pytest`, Node `node --test` and an allowlisted custom test command. It is a process-level boundary, not a container or hardened hostile-code VM; use a disposable VM for untrusted repositories.
- **Evidence receipts are local tamper evidence, not external identity.** Reports create HMAC-signed, hash-chained receipts in `~/.agent-office/evidence.json` (mode `0600`) with a local key in `~/.agent-office/evidence.key` (mode `0600`). Verification detects edited/deleted/reordered receipts and changed/missing files or reports. It does not prove report truth and optional HMAC request signing proves possession of an agent secret, not real-world identity. A separate `evidence.anchor` detects rollback of `evidence.json` alone, but rolling back both evidence and anchor remains possible without an external anchor; there is no public-key attestation. Back up `evidence.key` with `evidence.json` and `evidence.anchor`; losing the key invalidates old receipts. Do not present receipts as third-party identity or legal proof.
- **MCP deliverable uploads are untrusted text.** `agent_office_upload_deliverable` writes agent-supplied text into the mission upload directory and records its hash; it is not executed automatically. The agent must be the task assignee. Content is capped at 2MB and names are sanitized. Review before running tests or opening files.
- The four mission boss gates are enforced in the bridge: spend, business final calls, QR login and authorization. Reports that try to escalate a technical issue are rejected.
- Boss approval endpoints are local-only and have no separate user authentication. They inherit the bridge's loopback Host/Origin trust model and must not be exposed publicly.
- QR login approvals accept an agent-supplied QR/link attachment; Agent Office does not store provider passwords or implement third-party OAuth. Do not put secrets in QR codes or chat messages.
- Mission state is stored in `~/.agent-office/missions.json`; it is local, unencrypted JSON and not multi-tenant. The bridge state (including per-agent signing secrets) is `~/.agent-office/bridge-state.json` with mode `0600`; protect and back it up accordingly.
- Agent brand/logo detection is a local string match over name and runtime. It does not fetch remote logos, call vendor APIs or send agent metadata anywhere.
- External agent role appointment and avatar choice are local bridge metadata. Built-in avatars are emoji/glyph presets; custom avatars are a 1–2 character label plus a validated hex color, so they cannot inject HTML or fetch a remote image.
- Recommendation is advisory and runs on the local bridge; when external agents exist it uses only those agents, otherwise it falls back to system roles. It uses local skills, role, online state, load and estimates. A user-selected or preferred executor is still validated against the selected member list before assignment.
- AI discussion/run sends the mission charter, tasks and excerpts of extracted text to the configured model provider. Do not put secrets or regulated data in a mission if you do not trust that provider.
- The app uses `localStorage` for names, hires, snapshots and external profiles. Treat browser storage as local, unencrypted state.
- The demo agent is for local demonstration only.

## Hardening checklist

- Keep `bridge.py` on loopback.
- Use a dedicated `BRIDGE_PORT` and do not port-forward it.
- Keep `BRIDGE_ALLOW_REMOTE` unset unless you also set `BRIDGE_TOKEN`; add TLS/identity at the proxy.
- Do not treat delivery verification or a signed receipt as proof of functional correctness, external identity or legal attestation.
- Do not run untrusted repositories in the local test sandbox; use a disposable VM. The sandbox is a process boundary, not a hardened container.
- Delete unused pairing codes, or let them expire; claimed codes cannot be deleted.
- Review external agent event payloads before ingesting them into a shared environment.
- Back up and inspect `~/.agent-office/bridge-state.json` before sharing a machine.
- Provider keys belong in bridge env or `~/.agent-office/providers.json`, never in the repo or browser. Prompts are sent to the provider you configure.

## Known non-goals

This repository is not a hardened VM for untrusted code execution. Delivery verification checks syntax and evidence; the opt-in test runner is a process-level sandbox (seatbelt/bubblewrap), not a container. External agents are separate processes; run them in an environment appropriate to their permissions.
