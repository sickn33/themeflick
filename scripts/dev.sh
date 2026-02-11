#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/web"

if [[ ! -d "$WEB_DIR" ]]; then
  echo "[dev] Missing web/ directory" >&2
  exit 1
fi

echo "[dev] starting Vite web on http://127.0.0.1:5173"
cd "$WEB_DIR"
npm run dev
