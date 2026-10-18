#!/usr/bin/env bash
# Installs the service as a per-user LaunchAgent.
#   scripts/install.sh              build + install + load
#   scripts/install.sh --print-plist  print the plist (used by tests/CI)
#   scripts/install.sh --uninstall  unload + remove
set -euo pipefail

LABEL="com.codex-cu.service"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="${CODEX_CU_BIN_DIR:-$HOME/.local/bin}"
SUPPORT="${CODEX_CU_SUPPORT:-$HOME/Library/Application Support/codex-cu}"
SOCKET="$SUPPORT/computeruse.sock"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

print_plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN_DIR/codex-cu</string>
    <string>--socket</string>
    <string>$SOCKET</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$SUPPORT/service.log</string>
  <key>StandardErrorPath</key><string>$SUPPORT/service.log</string>
</dict>
</plist>
PLIST
}

case "${1:-install}" in
  --print-plist)
    print_plist
    ;;
  --uninstall)
    launchctl bootout "gui/$UID" "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "uninstalled $LABEL"
    ;;
  install)
    swift build -c release --package-path "$REPO/service"
    mkdir -p "$BIN_DIR" "$SUPPORT" "$HOME/Library/LaunchAgents"
    cp "$REPO/service/.build/release/CodexCU" "$BIN_DIR/codex-cu"
    chmod +x "$BIN_DIR/codex-cu"
    print_plist > "$PLIST"
    launchctl bootout "gui/$UID" "$PLIST" 2>/dev/null || true
    launchctl bootstrap "gui/$UID" "$PLIST"
    echo "installed $LABEL"
    echo "socket: $SOCKET"
    echo
    echo "Grant permissions before first use:"
    echo "  System Settings > Privacy & Security > Accessibility  -> add $BIN_DIR/codex-cu"
    echo "  System Settings > Privacy & Security > Screen Recording -> add $BIN_DIR/codex-cu"
    echo "Then: launchctl kickstart -k gui/$UID/$LABEL"
    ;;
  *)
    echo "usage: $0 [install|--uninstall|--print-plist]" >&2
    exit 2
    ;;
esac
