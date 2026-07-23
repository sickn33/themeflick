#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/web"
API_DIR="$ROOT_DIR/api"

echo "[verify] running frontend lint"
(cd "$WEB_DIR" && npm run lint)

echo "[verify] running frontend tests"
(cd "$WEB_DIR" && npm run test)

echo "[verify] checking database schema and migration history"
(cd "$WEB_DIR" && npm run db:check)
(cd "$WEB_DIR" && npm run db:validate)

echo "[verify] running frontend build"
(cd "$WEB_DIR" && npm run build)

echo "[verify] checking backend formatting"
(cd "$API_DIR" && cargo fmt --check)

echo "[verify] running backend tests"
(cd "$API_DIR" && cargo test --locked)

echo "[verify] all checks passed"
