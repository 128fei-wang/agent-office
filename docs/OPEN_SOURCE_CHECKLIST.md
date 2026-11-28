# Open-source launch checklist

## Already in the repo

- MIT `LICENSE`
- `README.md` + `README.en.md`
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
- `CHANGELOG.md`, `VERSION`, `.editorconfig`, `.gitignore`
- `docs/ARCHITECTURE.md`, `docs/PAIRING.md`, `docs/PROVIDERS.md`, `docs/TASK_DELEGATION.md`, `docs/COMPANY_OS.md`, `docs/MISSIONS.md`, `docs/UPGRADING.md`, `docs/EVENT_PROTOCOL.md`, `docs/ROADMAP.md`
- `.github/workflows/ci.yml` (syntax, bridge integration tests, required files)
- `.github/workflows/pages.yml` (optional static UI demo; the bridge is local-only)
- issue templates + PR template
- screenshots in `docs/screenshots/`
- `tests/test_bridge.py` (bridge integration tests)
- `tests/test_updater.py` (self-update unit tests)
- `tests/test_missions.py` (mission planning, reports, approvals and file extraction)
- `missions.py` + `src/missions.js` (Mission Control)
- `updater.py` + `update.sh` (in-app and terminal self-update)
- `scripts/check.sh`

## Owner actions before publishing

1. Create the GitHub repository (suggested name: `agent-office`).
2. Confirm or change the MIT license and copyright holder.
3. Set the description:
   `A local-first multi-agent office and one-person-company workspace with realtime chat, task isolation, audit, Trace Lab, external-agent pairing and bilingual UI.`
4. Add topics:
   `agents`, `multi-agent`, `observability`, `llm`, `agentops`, `opentelemetry`, `simulation`, `pixel-art`, `local-first`, `one-person-company`, `group-chat`, `i18n`.
5. Upload a screenshot as the social preview (use `docs/screenshots/office.jpg`).
6. Tag releases and publish notes from `CHANGELOG.md` (currently `v1.27.0`).
7. Enable Issues and Discussions (recommended).
8. Enable GitHub Pages with **Source: GitHub Actions** if you want a live UI demo
   (the static office works; external-agent pairing needs a local bridge).
9. Do not publish bridge state, update backups or provider keys: they live in `~/.agent-office/`, outside the repo.

## Publish from this folder

Once the repository name/owner is confirmed:

```bash
git init -b main
git add .
git commit -m "feat: initial Agent Office release"
# create an empty public repo named agent-office first, then:
git remote add origin https://github.com/<owner>/agent-office.git
git push -u origin main
```

Or, with the GitHub CLI installed and authenticated:

```bash
gh repo create agent-office --public --source=. --remote=origin --push
```

Do not commit bridge state or provider keys. The default files live in
`~/.agent-office/`; legacy repo-root filenames are also ignored.

## Suggested release blurb

> Agent Office is a zero-dependency, local-first multi-agent office and one-person-company workspace: watch a team work, inspect every skill/tool/file/line, replay traces, run evals, chat in isolated task rooms, pair external agents, and upgrade later releases from the app.

## What not to claim yet

- Do not call this a production observability platform.
- Do not claim real code diffs or real token/cost data for the simulated office.
- Do not claim external agents execute tasks; they currently emit telemetry only.
- Do not claim the bridge is secure for public exposure.
