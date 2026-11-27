#!/bin/sh
set -e
cd "$(dirname "$0")"
PORT="${1:-5173}"
URL="http://127.0.0.1:$PORT"
echo ""
BRIDGE_PORT="${BRIDGE_PORT:-8787}"
echo "  AGENT OFFICE"
echo "  $URL"
echo "  bridge  http://127.0.0.1:$BRIDGE_PORT"
echo "  Ctrl+C 停止"
echo ""
BRIDGE_PID=""
cleanup() {
  if [ -n "$BRIDGE_PID" ]; then
    kill "$BRIDGE_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

bridge_healthy() {
  python3 - "$BRIDGE_PORT" <<'PY' >/dev/null 2>&1
import sys, urllib.request
port = sys.argv[1]
with urllib.request.urlopen("http://127.0.0.1:" + port + "/health", timeout=0.6) as res:
    assert res.status == 200
PY
}

if ! command -v python3 >/dev/null 2>&1; then
  echo "  python3 not found; external agent bridge disabled"
elif bridge_healthy; then
  echo "  bridge already running on $BRIDGE_PORT (reusing it)"
else
  python3 "$(dirname "$0")/bridge.py" --port "$BRIDGE_PORT" >/tmp/agent-office-bridge.log 2>&1 &
  BRIDGE_PID=$!
  i=0
  while [ "$i" -lt 20 ] && ! bridge_healthy; do
    i=$((i + 1))
    sleep 0.15
  done
  if bridge_healthy; then
    echo "  bridge ready"
  else
    echo "  WARNING: bridge did not become healthy; see /tmp/agent-office-bridge.log"
  fi
fi
if command -v open >/dev/null 2>&1; then
  (sleep 0.6 && open "$URL") >/dev/null 2>&1 &
fi
python3 serve.py "$PORT"
