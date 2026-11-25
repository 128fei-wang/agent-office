# Upgrading Agent Office

Agent Office does **not** modify itself in the background. Updating is always
explicit:

1. the user checks the official GitHub release feed;
2. the current app is backed up;
3. the update is downloaded or fast-forwarded;
4. the new files are verified;
5. the bridge restarts;
6. the page reloads.

The previous version stays available as a local backup and can be restored from
the same panel.

> Users still on **1.2.0 or older** do not have the updater yet. Upgrade once
> manually with `git pull` or a release download; after that, the in-app
> updater is available.

## In the app

- Click **升级 / UPDATE** in the top bar, or press `U`.
- Deep link: `http://127.0.0.1:5173/?update=1`
- Click **检查更新 / Check for updates**.
- `?update=0` disables the passive six-hour check; updates still work from the
  button or `./update.sh`.

If a newer release exists, the panel shows the current/latest versions, release
notes, update mode and backup status. **立即升级 / Update now** opens a
confirmation step. The panel then reports progress and restarts the bridge.

When the bridge is back, the page reloads automatically. If the restart times
out, the panel says so; refresh manually or run `./start.sh`.

### Rollback

Every successful update creates a backup in:

```text
~/.agent-office/backups/<timestamp>/
```

The update panel shows the newest backup from a different version and a
**回滚 / Roll back** action.
Rollback restores the application files, restarts the bridge and reloads the
page. Browser data, company state, pair codes and model keys are not touched.

## CLI

The same updater is available without the UI:

```bash
./update.sh --check          # show current/latest and deployment mode
./update.sh --apply          # confirm, back up, update (no automatic restart)
./update.sh --rollback       # restore the newest different-version backup
./update.sh --status         # last result and recent backups
./update.sh --check --json   # machine-readable
```

After a CLI update, restart the app yourself:

```bash
# Ctrl+C the current ./start.sh first
./start.sh
```

If `./start.sh` started the bridge, stopping the script is required; otherwise a
new `./start.sh` reuses the old bridge process on port 8787.

## How it decides what to do

The bridge calls the public GitHub Releases API for
[`128fei-wang/agent-office`](https://github.com/128fei-wang/agent-office).
No GitHub token is needed and no private data is sent.

| Deployment | Update path |
| --- | --- |
| Git checkout | `git fetch --tags --prune` then `git pull --ff-only` on the current branch |
| ZIP / copied folder / no `.git` | Download the official release tarball and merge it over the app |

A git checkout with uncommitted changes is **blocked** instead of overwritten.
Commit or back up those changes first. Detached HEAD checkouts are also
blocked.

Archive updates validate every tar member before extraction:

- no absolute paths or `..`;
- no symlinks, hard links or device entries;
- bounded entry count and unpacked size;
- required app files and a matching `VERSION`;
- `bridge.py` and `updater.py` must compile;
- the updated app's version must equal the release version.

## What is preserved

Updates replace application files only. These are outside the app directory and
are never overwritten:

| Data | Location |
| --- | --- |
| Agents, pairs, company, tasks, chat | `~/.agent-office/bridge-state.json` |
| Model API keys | `~/.agent-office/providers.json` |
| Backups and last update result | `~/.agent-office/backups`, `~/.agent-office/last-update.json` |
| Language, theme and browser snapshots | browser localStorage |

The app backup excludes `.git`, `bridge-state.json`, `providers.json`,
`__pycache__`, `build/` and local provider files. Five recent backups are kept.

## API

All endpoints are localhost-only and go through the bridge's Host/Origin gate.

```text
GET  /update/check?refresh=1
GET  /update/status
POST /update/apply       {"token": "...", "version": "1.3.0"}
POST /update/rollback    {"token": "..."}
```

`/update/check` returns a one-time apply token and a separate rollback token,
valid for 10 minutes. The bridge consumes the apply token before starting the
job. The update itself runs in a background thread; `/update/status` reports
`running`, `restarting`, `error` or `idle` with the last result.

When the update succeeds, the bridge calls `os.execv` and restarts itself with
the same port and arguments. `start.sh` still supervises the same PID.

## Failure handling

- **Network/GitHub error** — nothing is changed; retry later.
- **Git dirty / detached** — blocked before any file is written.
- **Version or syntax verification fails** — the app is restored from the
  backup automatically.
- **Bridge restart fails** — run `./update.sh --rollback` from a terminal, or
  restore `~/.agent-office/backups/<id>/app` manually.
- **Update token expired** — check again; tokens are single-use.
- **Bridge offline** — start `./start.sh`; the updater needs the local bridge.

## Limits

- Updates come only from the official GitHub release feed. There is no
  arbitrary URL or plugin source.
- TLS and the GitHub release pipeline are the trust boundary. Agent Office does
  not sign or verify a separate cryptographic signature.
- The updater is not a background auto-updater: it never installs without the
  user's confirmation.
- An archive update does not delete files that were removed upstream; those
  stale files are harmless but can be removed manually.
- A successful update must restart the bridge. If the process cannot start,
  use the CLI rollback.
