@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Ask your IT contact for an approved Node.js 22 or later runtime.
  if not "%FISHING_EXPLORER_NO_PAUSE%"=="1" pause
  exit /b 1
)
node "%~dp0scripts\launch.mjs" %*
set "FISHING_EXPLORER_EXIT=%errorlevel%"
if not "%FISHING_EXPLORER_NO_PAUSE%"=="1" pause
exit /b %FISHING_EXPLORER_EXIT%
