#!/usr/bin/env bash
# Swift Testing ships a macro plugin inside the CommandLineTools toolchain, but
# SwiftPM only auto-discovers it under a full Xcode install. Pass it explicitly
# when we detect the CLT-only layout.
set -euo pipefail
cd "$(dirname "$0")/.."
PLUGIN=/Library/Developer/CommandLineTools/usr/lib/swift/host/plugins/testing
if [[ "$(xcode-select -p 2>/dev/null || true)" == *CommandLineTools* && -d "$PLUGIN" ]]; then
  exec swift test --package-path service -Xswiftc -plugin-path -Xswiftc "$PLUGIN"
fi
exec swift test --package-path service
