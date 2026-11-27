#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")/.."

fail=0

if command -v python3 >/dev/null 2>&1; then
  python3 -m py_compile bridge.py updater.py missions.py
  echo "OK  bridge.py / updater.py / missions.py syntax"
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
  index.html styles.css trace.css hiring.css external.css theme.css company.css update.css missions.css features.css chat-v2.css memory.css usage.css ai-setup.css logos.css mission-live.css demo-mode.css favicon.svg
  start.sh update.sh serve.py scripts/sync-local.sh bridge.py updater.py missions.py ocr_vision.swift README.md README.en.md LICENSE CONTRIBUTING.md
  CODE_OF_CONDUCT.md SECURITY.md CHANGELOG.md VERSION
  src/data.js src/i18n.js src/sprites.js src/logos.js src/chat-ui.js src/chat-hub.js src/memory.js src/usage.js src/demo-mode.js src/engine.js src/fx.js src/trace.js
  src/hiring.js src/external.js src/company.js src/update.js src/ai-setup.js src/mission-live.js src/missions.js src/shell.js src/render.js src/main.js
  missions.py tests/test_missions.py tests/test_context.py
  dev-check.html dev-paths.html dev-consistency.html dev-actions.html dev-chat.html
  dev-fx.html dev-audit.html dev-tracelab.html dev-hiring.html dev-external.html
  dev-delegation.html dev-theme.html dev-company.html dev-i18n.html
  dev-update.html dev-update-manual.html dev-missions.html dev-features.html dev-usage.html dev-memory.html dev-ai-setup.html dev-mission-live.html dev-demo-mode.html dev-activity.html dev-guide.html dev-performance.html
  tests/test_bridge.py tests/test_updater.py providers.example.json
  assets/logos/openai.svg assets/logos/claude.svg assets/logos/workbuddy.svg assets/logos/doubao-mark.svg docs/ARCHITECTURE.md docs/LAYOUT.md docs/MCP.md docs/AI_SETUP.md docs/PAIRING.md docs/PROVIDERS.md docs/TASK_DELEGATION.md docs/COMPANY_OS.md docs/MISSIONS.md docs/UPGRADING.md docs/EVENT_PROTOCOL.md docs/ROADMAP.md docs/TRENDS.md docs/CHAT_UI.md docs/MEMORY.md docs/USAGE.md docs/ANIMATION.md docs/GUIDE.md docs/ACCEPTANCE.md
)
for f in "${required[@]}"; do
  if [ ! -e "$f" ]; then
    echo "MISSING $f"
    fail=1
  fi
done

if [ ! -x update.sh ]; then
  echo "update.sh is not executable"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "Repository check failed"
  exit 1
fi
echo "OK  required files present"
echo "Repository check complete."
