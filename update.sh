#!/bin/sh
# Agent Office updater CLI.
#   ./update.sh --check
#   ./update.sh --apply
#   ./update.sh --rollback
#   ./update.sh --status
set -e
cd "$(dirname "$0")"
exec python3 -I updater.py "$@"
