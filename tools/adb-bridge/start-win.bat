@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ASCII-only control flow. UTF-8 Chinese in .bat often flash-closes on CN Windows.
rem Always pause at the end so the console never disappears instantly.

set "EXIT_CODE=0"
set "LOG_FILE=%TEMP%\devtools-adb-bridge-last-start.log"
call :MAIN
set "EXIT_CODE=!ERRORLEVEL!"

echo.
echo ========================================
echo Exit code: !EXIT_CODE!
echo Log file:  !LOG_FILE!
if exist "%USERPROFILE%\Desktop\" (
  copy /Y "!LOG_FILE!" "%USERPROFILE%\Desktop\devtools-adb-bridge-last-start.log" >nul 2>&1
  if exist "%USERPROFILE%\Desktop\devtools-adb-bridge-last-start.log" (
    echo Also copied to Desktop: devtools-adb-bridge-last-start.log
  )
)
echo ========================================
echo.
pause
exit /b !EXIT_CODE!

:MAIN
cd /d "%~dp0" 2>nul
set "SCRIPT_DIR=%~dp0"
set "BRIDGE_DIR=%USERPROFILE%\.devtools-adb-bridge"
if not exist "%BRIDGE_DIR%" mkdir "%BRIDGE_DIR%" 2>nul
if exist "%BRIDGE_DIR%\" set "LOG_FILE=%BRIDGE_DIR%\last-start.log"

echo ==== %DATE% %TIME% ==== > "%LOG_FILE%"
echo SCRIPT_DIR=%SCRIPT_DIR%>> "%LOG_FILE%"
echo BRIDGE_DIR=%BRIDGE_DIR%>> "%LOG_FILE%"
echo CD=%CD%>> "%LOG_FILE%"
where node >> "%LOG_FILE%" 2>&1
where adb >> "%LOG_FILE%" 2>&1
where curl >> "%LOG_FILE%" 2>&1

echo [ADB Bridge] Starting...
echo [ADB Bridge] Log: %LOG_FILE%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] node.exe not found.
  echo Install Node.js: https://nodejs.org/
  echo Then reopen this window / check PATH.
  echo [ERROR] node not found>> "%LOG_FILE%"
  exit /b 1
)

where adb >nul 2>&1
if errorlevel 1 (
  echo [ERROR] adb.exe not found.
  echo Install Android platform-tools and add it to PATH.
  echo [ERROR] adb not found>> "%LOG_FILE%"
  exit /b 1
)

set "TARGET=%BRIDGE_DIR%\server.js"
set "LOCAL_SERVER=%SCRIPT_DIR%server.js"
set "HAVE_SERVER=0"

if exist "%LOCAL_SERVER%" (
  copy /Y "%LOCAL_SERVER%" "%TARGET%" >nul
  if exist "%TARGET%" (
    echo [OK] Using server.js next to this script
    echo using local server.js>> "%LOG_FILE%"
    set "HAVE_SERVER=1"
  )
)

if "!HAVE_SERVER!"=="0" if exist "%TARGET%" (
  echo [OK] Using cached server.js
  echo using cached server.js>> "%LOG_FILE%"
  set "HAVE_SERVER=1"
)

if "!HAVE_SERVER!"=="0" (
  echo [..] Downloading server.js ...
  echo downloading server.js>> "%LOG_FILE%"
  if exist "%TARGET%.tmp" del /f /q "%TARGET%.tmp" >nul 2>&1

  where curl >nul 2>&1
  if not errorlevel 1 (
    curl.exe -fsSL --connect-timeout 15 --max-time 120 "https://afra55.github.io/tools/adb-bridge/server.js" -o "%TARGET%.tmp" >> "%LOG_FILE%" 2>&1
    if errorlevel 1 (
      curl.exe -fsSL --connect-timeout 15 --max-time 120 "https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/tools/adb-bridge/server.js" -o "%TARGET%.tmp" >> "%LOG_FILE%" 2>&1
    )
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing 'https://afra55.github.io/tools/adb-bridge/server.js' -OutFile '%TARGET%.tmp'; exit 0 } catch { try { Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/tools/adb-bridge/server.js' -OutFile '%TARGET%.tmp'; exit 0 } catch { exit 1 } }" >> "%LOG_FILE%" 2>&1
  )

  if not exist "%TARGET%.tmp" (
    echo [ERROR] Could not get server.js
    echo Keep server.js in the SAME folder as this .bat ^(re-download the ZIP^).
    echo [ERROR] download failed>> "%LOG_FILE%"
    exit /b 1
  )

  findstr /I /C:"ADB_BRIDGE_TOKEN" /C:"devtools-adb-bridge" /C:"DevTools local ADB bridge" "%TARGET%.tmp" >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] Downloaded file is invalid.
    del /f /q "%TARGET%.tmp" >nul 2>&1
    echo [ERROR] invalid download>> "%LOG_FILE%"
    exit /b 1
  )

  move /Y "%TARGET%.tmp" "%TARGET%" >nul
  echo [OK] Download complete
  set "HAVE_SERVER=1"
)

if not exist "%TARGET%" (
  echo [ERROR] Missing server.js: %TARGET%
  echo [ERROR] missing target>> "%LOG_FILE%"
  exit /b 1
)

cd /d "%BRIDGE_DIR%"
if "%ADB_BRIDGE_TOKEN%"=="" set "ADB_BRIDGE_TOKEN=devtools-adb"
if "%ADB_BRIDGE_PORT%"=="" set "ADB_BRIDGE_PORT=17888"

echo [OK] adb:
adb version
echo.
echo [OK] Starting: %TARGET%
echo      Keep this window open, then click Connect on the webpage.
echo.

node "%TARGET%"
set "CODE=!ERRORLEVEL!"
echo node exit=!CODE!>> "%LOG_FILE%"
echo.
if not "!CODE!"=="0" (
  echo [ERROR] Bridge exited with code !CODE!
  echo Scroll up for details. Log: %LOG_FILE%
  exit /b !CODE!
)

echo [OK] Bridge stopped.
exit /b 0
