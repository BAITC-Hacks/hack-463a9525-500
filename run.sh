#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -x .venv/bin/python ]]; then python3 -m venv .venv; fi
.venv/bin/python -m pip install -q -r requirements.txt
if [[ ! -d node_modules ]]; then npm ci; fi
.venv/bin/python pipeline.py --data data --out outputs
export MONEYGRAPH_OUTPUT_DIR="$PWD/outputs"
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port "${API_PORT:-8000}" &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true' EXIT INT TERM
export BACKEND_URL="http://127.0.0.1:${API_PORT:-8000}"
printf '\nMoneyGraph: http://127.0.0.1:%s/ | API: %s/docs\n' "${PORT:-3000}" "$BACKEND_URL"
npm run dev -- --port "${PORT:-3000}"
