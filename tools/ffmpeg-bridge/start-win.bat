@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo DevTools FFmpeg Bridge starting...
echo Need Node.js and ffmpeg on PATH.
echo.

set "LOG_DIR=%USERPROFILE%\.devtools-ffmpeg-bridge"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
set "LOG_FILE=%LOG_DIR%\last-start.log"
echo ==== %DATE% %TIME% ==== > "%LOG_FILE%"
where node >> "%LOG_FILE%" 2>&1
where ffmpeg >> "%LOG_FILE%" 2>&1

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Install from https://nodejs.org/
  echo Log: %LOG_FILE%
  pause
  exit /b 1
)

where ffmpeg >nul 2>&1
if errorlevel 1 (
  echo ffmpeg not found. Install FFmpeg and add it to PATH.
  echo Log: %LOG_FILE%
  pause
  exit /b 1
)

set "BRIDGE_DIR=%USERPROFILE%\.devtools-ffmpeg-bridge"
if not exist "%BRIDGE_DIR%" mkdir "%BRIDGE_DIR%"
set "TARGET=%BRIDGE_DIR%\server.js"

if exist "%~dp0server.js" (
  copy /Y "%~dp0server.js" "%TARGET%" >nul
  echo Using local server.js
) else if exist "%TARGET%" (
  echo Using cached server.js
) else (
  echo server.js missing. Re-download the full ZIP from the website.
  echo Log: %LOG_FILE%
  pause
  exit /b 1
)

cd /d "%BRIDGE_DIR%"
set "FFMPEG_BRIDGE_TOKEN=devtools-ffmpeg"
set "FFMPEG_BRIDGE_PORT=17889"
echo Starting bridge...
echo.
node server.js
set "CODE=%ERRORLEVEL%"
echo.
if not "%CODE%"=="0" (
  echo Bridge exited with code %CODE%.
  echo Log: %LOG_FILE%
  copy /Y "%LOG_FILE%" "%USERPROFILE%\Desktop\devtools-ffmpeg-bridge-last-start.log" >nul 2>&1
)
pause
exit /b %CODE%
