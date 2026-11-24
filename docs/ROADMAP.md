# Roadmap and known gaps

This is an early open-source prototype, not a production observability or agent-execution platform.

## P0 — before publishing

- [x] MIT license, security policy, contribution guide, code of conduct.
- [x] CI syntax checks + required-file checks.
- [x] Screenshots and architecture docs.
- [x] One-time pairing-code flow for external agents.
- [x] English README.
- [x] Bridge integration tests and local Host/Origin checks.
- [x] Optional static GitHub Pages demo workflow.
- [x] Model API adapters: Doubao, DeepSeek, WorkBuddy, Gemini, Claude, OpenAI, Kimi, Qwen, Ollama.
- [ ] Create the GitHub repository, add description/topics, social preview and a release tag.
- [ ] Confirm the license and maintainer identity with the owner.
- [ ] Add a short demo video/GIF (optional but recommended for launch).

## P1 — product correctness

- [ ] External task delegation: assign a task to an external agent, receive progress/complete events, validate and write back status.
- [ ] Persist bridge state in SQLite (or document JSON as a demo-only store).
- [ ] Bridge authentication/TLS guidance for non-local deployments.
- [ ] Real run comparison and trace import (OTLP ingest).
- [ ] Replace simulated token/cost/duration with real agent telemetry when available.
- [ ] More robust pathfinding around hot desks and future furniture.

## P2 — engineering

- [ ] Automated browser E2E on CI (Playwright) for the `dev-*.html` pages.
- [ ] Extract CSS into feature modules / design tokens.
- [ ] TypeScript or JSDoc type checking for the engine/event schema.
- [ ] Accessibility audit and keyboard-only pass for all drawers/modals.
- [ ] i18n (zh-CN / en) beyond the README.
- [ ] Packaging: Docker or a `start.sh` that waits for/reuses a healthy bridge.
- [ ] Versioned event protocol and migration for snapshots.

## Known limitations

- External agents and model APIs do not claim or complete tasks yet.
- Model API calls are one-shot; no streaming, retries or provider price calculation.
- External agent endpoints are metadata only; the bridge does not call them.
- The bridge has no auth, TLS, multi-tenancy or retention policy.
- Simulation evidence (files/lines/diffs/tokens/cost) is synthetic; real external events carry their own fields.
- Static GitHub Pages cannot run `bridge.py`; the office UI works, but pairing/heartbeats need a local bridge.
