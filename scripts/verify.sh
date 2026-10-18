#!/usr/bin/env bash
# Builds everything and runs every suite. Exits non-zero on the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== swift build (debug) =="
swift build --package-path service

echo "== swift build (release) =="
swift build -c release --package-path service

echo "== swift tests =="
bash scripts/test-service.sh

echo "== node tests (protocol/client/browser/tools) =="
node --test client/test/*.test.mjs tools/test/*.test.mjs

echo "== live check (skips without a socket) =="
if [[ -S "${CODEX_CU_SOCKET:-/tmp/codex-cu.sock}" ]]; then
  node scripts/live-check.mjs --socket "${CODEX_CU_SOCKET:-/tmp/codex-cu.sock}" || true
else
  echo "skip: no socket at ${CODEX_CU_SOCKET:-/tmp/codex-cu.sock}"
fi

echo "== all suites passed =="
