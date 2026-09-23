#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -x .venv/bin/python ]]; then python3 -m venv .venv; fi
.venv/bin/python -m pip install -q -r requirements.txt
if [[ ! -d node_modules ]]; then npm ci; fi
.venv/bin/python pipeline.py --data data --out out
printf '\nОткройте http://127.0.0.1:%s/\n' "${PORT:-3000}"
exec npm run dev -- --port "${PORT:-3000}"
