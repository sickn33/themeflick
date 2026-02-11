#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/api"
WEB_DIR="$ROOT_DIR/web"

if [[ ! -d "$API_DIR" || ! -d "$WEB_DIR" ]]; then
  echo "[dev] Missing api/ or web/ directory" >&2
  exit 1
fi

if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
fi

echo "[dev] starting Rust API on http://127.0.0.1:3000"
(
  cd "$API_DIR"
  cargo run
) &
API_PID=$!

cleanup() {
  echo "[dev] stopping background API process ($API_PID)"
  kill "$API_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "[dev] starting Vite web on http://127.0.0.1:5173"
cd "$WEB_DIR"
npm run dev
