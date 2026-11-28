#!/usr/bin/env bash
# Build the committed brand raster assets from the local SVG sources.
# Development-only; the shipped app has no build step and needs no browser.
# Requires macOS (sips, iconutil) and Chromium/Chrome for SVG rasterization.
set -euo pipefail
cd "$(dirname "$0")/.."

BRAND="assets/brand"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/agent-office-icons.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

for cmd in python3 sips iconutil; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "build-icons: missing $cmd (macOS required)" >&2
    exit 1
  fi
done
[ "$(uname -s)" = "Darwin" ] || { echo "build-icons: macOS required for sips/iconutil" >&2; exit 1; }

render() {
  python3 scripts/render-svg.py "$1" "$2" --width "$3" --height "$4" >/dev/null
}

resize() {
  sips -z "$2" "$2" "$1" --out "$3" >/dev/null
}

echo "== rendering masters =="
render "$BRAND/agent-office-mark.svg" "$TMP/mark-1024.png" 1024 1024
render "$BRAND/agent-office-app-icon.svg" "$TMP/app-1024.png" 1024 1024
render "$BRAND/agent-office-touch.svg" "$TMP/touch-1024.png" 1024 1024
render "$BRAND/agent-office-maskable.svg" "$TMP/maskable-1024.png" 1024 1024
render "$BRAND/agent-office-favicon.svg" "$BRAND/favicon-16.png" 16 16
render "$BRAND/agent-office-favicon.svg" "$BRAND/favicon-32.png" 32 32
render "$BRAND/agent-office-favicon.svg" "$BRAND/favicon-48.png" 48 48
render "$BRAND/agent-office-social.svg" "$BRAND/og-image.png" 1200 630
render "$BRAND/agent-office-logo.svg" "$BRAND/agent-office-logo.png" 1200 360

echo "== web / PWA icons =="
resize "$TMP/touch-1024.png" 180 "$BRAND/apple-touch-icon.png"
resize "$TMP/mark-1024.png" 192 "$BRAND/icon-192.png"
resize "$TMP/mark-1024.png" 512 "$BRAND/icon-512.png"
resize "$TMP/maskable-1024.png" 512 "$BRAND/icon-maskable-512.png"

echo "== macOS iconset =="
rm -rf "$BRAND/icon.iconset"
mkdir -p "$BRAND/icon.iconset"
cp "$BRAND/favicon-16.png" "$BRAND/icon.iconset/icon_16x16.png"
cp "$BRAND/favicon-32.png" "$BRAND/icon.iconset/icon_16x16@2x.png"
cp "$BRAND/favicon-32.png" "$BRAND/icon.iconset/icon_32x32.png"
resize "$TMP/app-1024.png" 64 "$BRAND/icon.iconset/icon_32x32@2x.png"
resize "$TMP/app-1024.png" 128 "$BRAND/icon.iconset/icon_128x128.png"
resize "$TMP/app-1024.png" 256 "$BRAND/icon.iconset/icon_128x128@2x.png"
resize "$TMP/app-1024.png" 256 "$BRAND/icon.iconset/icon_256x256.png"
resize "$TMP/app-1024.png" 512 "$BRAND/icon.iconset/icon_256x256@2x.png"
resize "$TMP/app-1024.png" 512 "$BRAND/icon.iconset/icon_512x512.png"
resize "$TMP/app-1024.png" 1024 "$BRAND/icon.iconset/icon_512x512@2x.png"
iconutil -c icns "$BRAND/icon.iconset" -o "$BRAND/AppIcon.icns"

echo "== Windows ICO =="
resize "$TMP/app-1024.png" 256 "$BRAND/icon-256.png"
# Rebuild ICO now that the 256px source exists.
python3 - "$BRAND/favicon.ico" "$BRAND/favicon-16.png" "$BRAND/favicon-32.png" "$BRAND/favicon-48.png" "$BRAND/icon-256.png" <<'PY'
import struct, sys
from pathlib import Path
out = Path(sys.argv[1])
sources = [Path(p) for p in sys.argv[2:]]
images = [p.read_bytes() for p in sources]
header = struct.pack('<HHH', 0, 1, len(images))
offset = 6 + 16 * len(images)
entries = []
for path, data in zip(sources, images):
    size = 0 if path.name.startswith('icon-256') else int(path.stem.split('-')[-1])
    entries.append(struct.pack('<BBBBHHII', size, size, 0, 0, 1, 32, len(data), offset))
    offset += len(data)
out.write_bytes(header + b''.join(entries) + b''.join(images))
print(f"wrote {out} ({len(images)} sizes)")
PY

cp "$BRAND/agent-office-favicon.svg" favicon.svg
mkdir -p build
cp "$BRAND/AppIcon.icns" build/AppIcon.icns
rm -rf build/icon.iconset
cp -R "$BRAND/icon.iconset" build/icon.iconset

echo "== verify dimensions =="
python3 - "$BRAND" <<'PY'
import struct, sys
from pathlib import Path
root = Path(sys.argv[1])
expected = {
    'favicon-16.png': (16, 16), 'favicon-32.png': (32, 32), 'favicon-48.png': (48, 48),
    'apple-touch-icon.png': (180, 180), 'icon-192.png': (192, 192),
    'icon-512.png': (512, 512), 'icon-maskable-512.png': (512, 512),
    'icon-256.png': (256, 256), 'og-image.png': (1200, 630),
    'agent-office-logo.png': (1200, 360),
}
for name, (w, h) in expected.items():
    data = (root / name).read_bytes()[:24]
    got = struct.unpack('>II', data[16:24])
    if got != (w, h):
        raise SystemExit(f"{name}: expected {(w,h)}, got {got}")
print(f"OK  {len(expected)} raster assets")
print(f"OK  {root / 'AppIcon.icns'} ({ (root / 'AppIcon.icns').stat().st_size } bytes)")
PY
echo "Brand assets built."
