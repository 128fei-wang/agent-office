#!/bin/sh
# Sync this working tree into the local installed copy used by AgentOffice.app.
# Usage: scripts/sync-local.sh [destination]
set -eu
SRC=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DEST=${1:-"$HOME/agent-office"}
if [ ! -d "$DEST" ]; then
  echo "Destination not found: $DEST" >&2
  exit 1
fi
rsync -a \
  --exclude='.git' \
  --exclude='__pycache__' \
  --exclude='.DS_Store' \
  --exclude='bridge-state.json' \
  --exclude='missions.json' \
  --exclude='providers.json' \
  --exclude='providers.local.json' \
  --exclude='uploads/' \
  --exclude='backups/' \
  --exclude='last-update.json' \
  --exclude='update.lock' \
  "$SRC/" "$DEST/"
for required in index.html styles.css features.css chat-v2.css memory.css usage.css demo-mode.css missions.css src/main.js src/shell.js src/memory.js src/usage.js bridge.py missions.py site.webmanifest sw.js assets/brand/agent-office-mark.svg assets/brand/AppIcon.icns; do
  if [ ! -e "$DEST/$required" ]; then
    echo "Sync incomplete: missing $required" >&2
    exit 1
  fi
done
echo "Synced $(cat "$SRC/VERSION") -> $DEST"
echo "Reload the AgentOffice window (Cmd+R / Ctrl+R) to pick up CSS/JS changes."
