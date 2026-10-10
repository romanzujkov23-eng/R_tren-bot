#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
[ -f backend/.env ] || { cp backend/.env.example backend/.env; echo "Создан backend/.env - впишите BOT_TOKEN при необходимости"; }
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r backend/requirements.txt
(cd frontend && [ -d node_modules ] || npm install)
trap 'kill 0' EXIT
(cd backend && ../.venv/bin/uvicorn app.main:app --reload --port 8000) &
(cd frontend && npm run dev) &
wait
