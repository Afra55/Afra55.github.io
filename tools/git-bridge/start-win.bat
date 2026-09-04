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

set "GIT_BRIDGE_DIR=%~dp0"
rem 独立 Git 桥已废弃：优先转到上级统一桥
if not defined GIT_BRIDGE_FORCE_STANDALONE (
  if exist "%~dp0..\start-win.bat" (
    echo Git 已并入统一桥。正在启动上级 adb-bridge...
    call "%~dp0..\start-win.bat" %*
    exit /b %ERRORLEVEL%
  )
  if exist "%~dp0..\start-win.cmd" (
    echo Git 已并入统一桥。正在启动上级 adb-bridge...
    call "%~dp0..\start-win.cmd" %*
    exit /b %ERRORLEVEL%
  )
)
if not defined GIT_BRIDGE_TOKEN set "GIT_BRIDGE_TOKEN=devtools-bridge"
if not defined GIT_BRIDGE_PORT set "GIT_BRIDGE_PORT=17888"
if /i "%~1"=="devtools-git://start" set "DEVTOOLS_GIT_QUIET=1"
if /i "%~1"=="devtools-bridge://start" set "DEVTOOLS_GIT_QUIET=1"
echo Starting bridge on http://127.0.0.1:%GIT_BRIDGE_PORT%
echo Token: %GIT_BRIDGE_TOKEN%
echo 提示: 网页只连接统一桥 17888 /git。独立调试请设 GIT_BRIDGE_FORCE_STANDALONE=1
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
