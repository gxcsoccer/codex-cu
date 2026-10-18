#!/usr/bin/env bash
# Builds everything and runs every suite. Exits non-zero on the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== swift build =="
swift build --package-path service

echo "== swift tests =="
bash scripts/test-service.sh

echo "== node tests (protocol/client/browser/tools) =="
node --test client/test/*.test.mjs tools/test/*.test.mjs

echo "== all suites passed =="
