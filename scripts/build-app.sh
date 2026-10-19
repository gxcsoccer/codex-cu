#!/usr/bin/env bash
# Builds "Codex CU.app" around the service binary so it can be granted TCC
# permissions as an app bundle. Usage: scripts/build-app.sh [--output DIR] [--print-plist]
set -euo pipefail
cd "$(dirname "$0")/.."

OUTPUT="dist"
PRINT_PLIST=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) OUTPUT="$2"; shift 2 ;;
    --print-plist) PRINT_PLIST=1; shift ;;
    -h|--help) echo "usage: scripts/build-app.sh [--output DIR] [--print-plist]"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

plist() {
  cat <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Codex CU</string>
  <key>CFBundleDisplayName</key><string>Codex CU</string>
  <key>CFBundleIdentifier</key><string>com.codex-cu.agent</string>
  <key>CFBundleExecutable</key><string>CodexCU</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAccessibilityUsageDescription</key>
  <string>Codex CU observes and controls applications for agent tasks.</string>
  <key>NSScreenCaptureUsageDescription</key>
  <string>Codex CU captures windows for agent tasks.</string>
  <key>NSAppleEventsUsageDescription</key>
  <string>Codex CU controls applications for agent tasks.</string>
</dict>
</plist>
PLIST
}

if [[ "$PRINT_PLIST" == "1" ]]; then
  plist
  exit 0
fi

swift build -c release --package-path service
APP="$OUTPUT/Codex CU.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp service/.build/release/CodexCU "$APP/Contents/MacOS/CodexCU"
chmod +x "$APP/Contents/MacOS/CodexCU"
plist > "$APP/Contents/Info.plist"

if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "warning: ad-hoc codesign failed" >&2
fi

echo "built: $APP"
echo "grant Accessibility and Screen Recording to: $APP"
echo "launch: open \"$PWD/$APP\" --args --socket /tmp/codex-cu.sock --audio"
