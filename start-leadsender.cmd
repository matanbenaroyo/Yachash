@echo off
REM ============================================================
REM  LeadSender launcher
REM
REM  Starts the app in the isolated dev environment
REM  (%APPDATA%\leadsender-dev) - the same one holding the
REM  chatbot settings, API key and the connected WhatsApp
REM  session, so nothing has to be set up again.
REM
REM  The console window is minimised, not hidden: if the app
REM  fails to start you can restore it and read the error.
REM ============================================================

cd /d "%~dp0"

REM Only one instance may run. Two copies fight over the same
REM WhatsApp session folder and the same SQLite database.
tasklist /FI "IMAGENAME eq electron.exe" 2>nul | find /I "electron.exe" >nul
if not errorlevel 1 (
    echo LeadSender is already running.
    timeout /t 3 >nul
    exit /b 0
)

if not exist "node_modules\electron" (
    echo.
    echo   Dependencies are missing. Run this once:
    echo       npm ci --ignore-scripts ^&^& npm run setup
    echo.
    pause
    exit /b 1
)

echo Starting LeadSender...
call npm run electron:dev
