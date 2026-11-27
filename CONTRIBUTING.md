# Contributing

Thanks for taking a look at Agent Office. It is a zero-dependency static app plus a small Python bridge; there is no build step or package manager required.

## Local setup

```bash
git clone <your-fork>
cd agent-office
./start.sh
# app:    http://127.0.0.1:5173
# bridge: http://127.0.0.1:8787
```

If port 5173 is already occupied:

```bash
python3 serve.py 5173
python3 bridge.py
```

## What to run before opening a PR

- `python3 -m py_compile bridge.py`
- `python3 -m unittest discover -s tests -v`
- `node --check src/*.js` (if Node is available; the app itself does not require Node)
- Browser self-checks:
  - `dev-check.html`
  - `dev-paths.html`
  - `dev-consistency.html`
  - `dev-actions.html`
  - `dev-fx.html`
  - `dev-audit.html?scenario=launch` and `?scenario=incident`
  - `dev-tracelab.html?scenario=launch` and `?scenario=incident`
  - `dev-hiring.html`
  - `dev-external.html` (bridge must be running)
  - `dev-delegation.html` (bridge must be running)
  - `dev-theme.html` (theme and mobile layout)
  - `dev-company.html` (one-person company, chat and isolation)
  - `dev-i18n.html` (language switch)
- `bash scripts/check.sh` covers syntax, required files, and the bridge tests run separately above.

`dev-external.html` starts and stops the bridge demo; it should leave the bridge in a clean state.

## Project rules

- No build step and no runtime package dependencies. Use browser APIs and Python stdlib.
- Keep simulation and observation separate. External agent events are currently read-only telemetry; do not silently mutate task state without a design.
- Do not put API keys or bridge tokens in frontend code. The bridge is localhost-only and has no authentication; do not expose it publicly.
- Keep event fields compatible with the documented event protocol and OTLP mapping in `docs/EVENT_PROTOCOL.md`.
- Escape user-provided names before injecting them into DOM.
- Add or update a `dev-*.html` check for behavior changes.
- Prefer small, focused PRs; explain the user-visible outcome and the failure modes you tested.

## UI conventions

- The app language is Chinese with English technical labels; keep that style.
- Preserve the night-shift command-center palette and the pixel-office geometry.
- Route effects should remain crisp hairlines / small beads; avoid blurred duplicate lines and shadow-like trails.
- Mobile layout uses the `@media (max-width: 980px / 620px)` blocks at the end of the CSS; add responsive styles there.

## Commit messages

Use a short imperative subject, for example:

```text
feat: add one-time pairing codes for external agents
fix: keep waiting pair cards in sync after claim
docs: document bridge event protocol
```

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do not paste secrets, tokens or private endpoints in a public issue.
