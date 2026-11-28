#!/usr/bin/env bash
# Apply the bundled Agent Office icon to a local macOS app bundle.
#
# Chromium-based bundles can contain an Assets.car with an AppIcon asset and
# CFBundleIconName=AppIcon. Replacing AppIcon.icns alone is not enough: macOS
# may keep using the asset catalog (for example the stock Chromium icon). This
# script uses a unique CFBundleIconFile and removes CFBundleIconName so the
# bundled ICNS is the source of truth.
#
# Usage: scripts/install-macos-icon.sh [/Applications/AgentOffice.app]
# This changes the app bundle and re-signs it ad-hoc. For a distribution build,
# re-sign with the real Developer ID identity instead.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:-/Applications/AgentOffice.app}"
APP="${APP%/}"
RES="$APP/Contents/Resources"
PLIST="$APP/Contents/Info.plist"
SRC="assets/brand/AppIcon.icns"

[ -d "$RES" ] || { echo "not an app bundle: $APP" >&2; exit 1; }
[ -f "$PLIST" ] || { echo "missing Info.plist: $PLIST" >&2; exit 1; }
[ -f "$SRC" ] || { echo "missing $SRC" >&2; exit 1; }
command -v /usr/libexec/PlistBuddy >/dev/null || { echo "PlistBuddy not found" >&2; exit 1; }
command -v codesign >/dev/null || { echo "codesign not found" >&2; exit 1; }

cp "$SRC" "$RES/AgentOfficeIcon.icns"
cp "$SRC" "$RES/AppIcon.icns"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIconFile AgentOfficeIcon' "$PLIST"
/usr/libexec/PlistBuddy -c 'Delete :CFBundleIconName' "$PLIST" 2>/dev/null || true

# Ad-hoc signing is correct for this local build. A distributed build should
# replace this with its normal signing/notarization step.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || {
  echo "warning: ad-hoc re-sign failed; the icon file is in place but the app may need re-signing" >&2
}
if codesign --verify --deep --strict "$APP" >/dev/null 2>&1; then
  echo "signature OK"
else
  echo "warning: codesign verification failed; re-sign before distribution" >&2
fi

touch "$APP"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$APP" >/dev/null 2>&1 || true
killall Dock >/dev/null 2>&1 || true
echo "Agent Office icon applied to $APP"
