@echo off
title Hosila Suite KeyGen (Private Owner Tool)
cd /d "%~dp0"

set "NODE_EXE=node"
if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"

:: Start local KeyGen server in background if not already running
start "" /B "%NODE_EXE%" "%~dp0server.mjs"
timeout /t 1 /nobreak >nul

:: Launch compact sticky-note sized app window in Edge or Chrome
set "URL=http://127.0.0.1:4791"
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=%URL% --window-size=405,670
  exit /b 0
)
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app=%URL% --window-size=405,670
  exit /b 0
)
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app=%URL% --window-size=405,670
  exit /b 0
)

:: Fallback to default browser
start "" "%URL%"

