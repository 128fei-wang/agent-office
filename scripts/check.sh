#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")/.."

fail=0

if command -v python3 >/dev/null 2>&1; then
  python3 -m py_compile bridge.py
  echo "OK  bridge.py syntax"
else
  echo "SKIP python3"
fi

if command -v node >/dev/null 2>&1; then
  for f in src/*.js; do
    node --check "$f"
    echo "OK  $f syntax"
  done
else
  echo "SKIP node (JS syntax checks need Node.js; the app itself has no Node runtime dependency)"
fi

required=(
  index.html styles.css trace.css hiring.css external.css favicon.svg
  start.sh bridge.py README.md README.en.md LICENSE CONTRIBUTING.md
  CODE_OF_CONDUCT.md SECURITY.md CHANGELOG.md VERSION
  src/data.js src/sprites.js src/engine.js src/fx.js src/trace.js
  src/hiring.js src/external.js src/render.js src/main.js
  dev-check.html dev-paths.html dev-consistency.html dev-actions.html
  dev-fx.html dev-audit.html dev-tracelab.html dev-hiring.html dev-external.html
  tests/test_bridge.py providers.example.json
  docs/ARCHITECTURE.md docs/PAIRING.md docs/PROVIDERS.md docs/EVENT_PROTOCOL.md docs/ROADMAP.md
)
for f in "${required[@]}"; do
  if [ ! -e "$f" ]; then
    echo "MISSING $f"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "Repository check failed"
  exit 1
fi
echo "OK  required files present"
echo "Repository check complete."
