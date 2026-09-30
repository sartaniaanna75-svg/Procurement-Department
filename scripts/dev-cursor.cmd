@echo off
REM Запуск Vite через Node из Cursor (системный npm/node не нужны).
setlocal
set "ROOT=%~dp0.."
set "CURSOR_NODE=%LOCALAPPDATA%\Programs\cursor\resources\app\resources\helpers\node.exe"
set "VITE=%ROOT%\node_modules\vite\bin\vite.js"

if not exist "%CURSOR_NODE%" (
  echo Не найден Node Cursor: %CURSOR_NODE%
  exit /b 1
)
if not exist "%VITE%" (
  echo Не найден Vite: %VITE%
  exit /b 1
)

cd /d "%ROOT%"
"%CURSOR_NODE%" "%VITE%" --port 5173 --host 127.0.0.1
