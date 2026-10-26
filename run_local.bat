@echo off
cd /d "%~dp0"
if not exist backend\.env copy backend\.env.example backend\.env
if not exist .venv python -m venv .venv
.venv\Scripts\pip install -q -r backend\requirements.txt
if not exist frontend\node_modules (cd frontend && call npm install && cd ..)
start "TrenBot API" cmd /k "cd backend && ..\.venv\Scripts\uvicorn app.main:app --reload --port 8000"
start "TrenBot Web" cmd /k "cd frontend && npm run dev"
echo Откройте http://localhost:5173
