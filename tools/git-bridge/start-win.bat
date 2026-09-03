@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo DevTools Git Bridge starting...
echo Need Node.js and git on PATH.
echo.

set "LOG_FILE=%~dp0last-start.log"
echo ==== %DATE% %TIME% ==== > "%LOG_FILE%"
echo SCRIPT_DIR=%~dp0 >> "%LOG_FILE%"
where node >> "%LOG_FILE%" 2>&1
where git >> "%LOG_FILE%" 2>&1

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Install from https://nodejs.org/
  echo Log: %LOG_FILE%
  pause
  exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
  echo git not found. Install Git for Windows and add it to PATH.
  echo Log: %LOG_FILE%
  pause
  exit /b 1
)

if not exist "%~dp0server.js" (
  echo server.js missing. Re-download the full ZIP from the website.
  echo Log: %LOG_FILE%
  pause
  exit /b 1
)

if not exist "%~dp0git-ops.js" (
  echo git-ops.js missing. Re-download the full ZIP from the website.
  echo Log: %LOG_FILE%
  pause
  exit /b 1
)

rem Register custom URL protocol so the webpage can request start (devtools-git://start)
set "GIT_BRIDGE_DIR=%~dp0"
reg add "HKCU\Software\Classes\devtools-git" /ve /d "URL:DevTools Git Bridge Protocol" /f >> "%LOG_FILE%" 2>&1
reg add "HKCU\Software\Classes\devtools-git" /v "URL Protocol" /d "" /f >> "%LOG_FILE%" 2>&1
reg add "HKCU\Software\Classes\devtools-git\shell\open\command" /ve /d "\"%~f0\" \"%1\"" /f >> "%LOG_FILE%" 2>&1
echo [OK] Registered protocol devtools-git:// >> "%LOG_FILE%"

set "GIT_BRIDGE_TOKEN=devtools-git"
set "GIT_BRIDGE_PORT=17890"
set "GIT_BRIDGE_DIR=%~dp0"
if /i "%~1"=="devtools-git://start" set "DEVTOOLS_GIT_QUIET=1"
echo Starting bridge on http://127.0.0.1:%GIT_BRIDGE_PORT%
echo Token: %GIT_BRIDGE_TOKEN%
echo.
node server.js
set "CODE=%ERRORLEVEL%"
echo.
if not "%CODE%"=="0" (
  echo Bridge exited with code %CODE%.
  echo Log: %LOG_FILE%
)
if /i not "%DEVTOOLS_GIT_QUIET%"=="1" pause
exit /b %CODE%
