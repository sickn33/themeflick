#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/api"
WEB_DIR="$ROOT_DIR/web"

if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
fi

echo "[verify] running Rust format check"
(cd "$API_DIR" && cargo fmt -- --check)

echo "[verify] running Rust tests"
(cd "$API_DIR" && cargo test)

echo "[verify] running frontend lint"
(cd "$WEB_DIR" && npm run lint)

echo "[verify] running frontend build"
(cd "$WEB_DIR" && npm run build)

echo "[verify] all checks passed"
