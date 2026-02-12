#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/web"

echo "[verify] running frontend lint"
(cd "$WEB_DIR" && npm run lint)

echo "[verify] running frontend tests"
(cd "$WEB_DIR" && npm run test)

echo "[verify] running frontend build"
(cd "$WEB_DIR" && npm run build)

echo "[verify] all checks passed"
