@echo off
chcp 65001 >nul
title Prompter MChiodi
cd /d "%~dp0"

where node >nul 2>nul || (
  echo [erro] Node.js nao encontrado. Instale em https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)

rem Web Speech API so funciona em Chrome/Edge: abre um deles quando o Vite subir.
set "URL=http://localhost:5173"
set "BROWSER=msedge"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start "" "%BROWSER%" %URL%"

echo Iniciando backend (:5179) e front (:5173). Ctrl+C para encerrar.
call npm run dev
pause
