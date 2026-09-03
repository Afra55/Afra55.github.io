@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ASCII-only control flow. UTF-8 Chinese in .bat often flash-closes on CN Windows.
rem All runtime files stay in the same folder as this script (no %USERPROFILE% cache).

set "EXIT_CODE=0"
call :MAIN
set "EXIT_CODE=!ERRORLEVEL!"

echo.
echo ========================================
echo Exit code: !EXIT_CODE!
echo Log file:  !LOG_FILE!
echo ========================================
echo.
pause
exit /b !EXIT_CODE!

:MAIN
cd /d "%~dp0" 2>nul
set "SCRIPT_DIR=%~dp0"
set "BRIDGE_DIR=%SCRIPT_DIR%"
set "LOG_FILE=%SCRIPT_DIR%last-start.log"

echo ==== %DATE% %TIME% ==== > "%LOG_FILE%"
echo SCRIPT_DIR=%SCRIPT_DIR%>> "%LOG_FILE%"
echo CD=%CD%>> "%LOG_FILE%"
where node >> "%LOG_FILE%" 2>&1
where adb >> "%LOG_FILE%" 2>&1
where curl >> "%LOG_FILE%" 2>&1

echo [ADB Bridge] Starting...
echo [ADB Bridge] Folder: %SCRIPT_DIR%
echo [ADB Bridge] Log: %LOG_FILE%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] node.exe not found.
  echo Install Node.js: https://nodejs.org/
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

rem Prepend Android SDK build-tools (apksigner.bat) when missing from PATH
where apksigner >nul 2>&1
if errorlevel 1 (
  if not defined ANDROID_HOME if defined ANDROID_SDK_ROOT set "ANDROID_HOME=%ANDROID_SDK_ROOT%"
  if not defined ANDROID_HOME if exist "%LOCALAPPDATA%\Android\Sdk" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
  if not defined ANDROID_HOME if exist "%USERPROFILE%\AppData\Local\Android\Sdk" set "ANDROID_HOME=%USERPROFILE%\AppData\Local\Android\Sdk"
  if defined ANDROID_HOME if exist "%ANDROID_HOME%\build-tools" (
    for /f "delims=" %%V in ('dir /b /ad /o-n "%ANDROID_HOME%\build-tools" 2^>nul') do (
      if exist "%ANDROID_HOME%\build-tools\%%V\apksigner.bat" (
        set "PATH=%ANDROID_HOME%\build-tools\%%V;%PATH%"
        echo [OK] Prepended build-tools %%V>> "%LOG_FILE%"
        goto :apksigner_path_done
      )
    )
  )
)
:apksigner_path_done
where apksigner >> "%LOG_FILE%" 2>&1

rem GUI / short PATH often misses JDK. Prepend common keytool locations when missing.
where keytool >nul 2>&1
if errorlevel 1 (
  if defined JAVA_HOME if exist "%JAVA_HOME%\bin\keytool.exe" set "PATH=%JAVA_HOME%\bin;%PATH%"
  if defined JDK_HOME if exist "%JDK_HOME%\bin\keytool.exe" set "PATH=%JDK_HOME%\bin;%PATH%"
  for %%D in (
    "%ProgramFiles%\Eclipse Adoptium"
    "%ProgramFiles%\Java"
    "%ProgramFiles%\Microsoft"
    "%ProgramFiles%\Amazon Corretto"
    "%LOCALAPPDATA%\Programs\Eclipse Adoptium"
  ) do (
    if exist %%~D (
      for /d %%J in ("%%~D\*") do (
        if exist "%%~J\bin\keytool.exe" set "PATH=%%~J\bin;%PATH%"
      )
    )
  )
)
where keytool >> "%LOG_FILE%" 2>&1

set "TARGET=%SCRIPT_DIR%server.js"
set "HAVE_SERVER=0"

if exist "%TARGET%" (
  echo [OK] Using server.js in this folder
  echo using local server.js>> "%LOG_FILE%"
  set "HAVE_SERVER=1"
)

if "!HAVE_SERVER!"=="0" (
  echo [..] Downloading server.js into this folder ...
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

  findstr /I /C:"ADB_BRIDGE_TOKEN" /C:"devtools-adb-bridge" /C:"devtools-bridge" /C:"DevTools local ADB bridge" /C:"统一本机桥" "%TARGET%.tmp" >nul 2>&1
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

set "MIRROR_TARGET=%SCRIPT_DIR%scrcpy-mirror.js"
if not exist "%MIRROR_TARGET%" (
  echo [..] Downloading scrcpy-mirror.js ...
  echo downloading scrcpy-mirror.js>> "%LOG_FILE%"
  if exist "%MIRROR_TARGET%.tmp" del /f /q "%MIRROR_TARGET%.tmp" >nul 2>&1
  where curl >nul 2>&1
  if not errorlevel 1 (
    curl.exe -fsSL --connect-timeout 15 --max-time 120 "https://afra55.github.io/tools/adb-bridge/scrcpy-mirror.js" -o "%MIRROR_TARGET%.tmp" >> "%LOG_FILE%" 2>&1
    if errorlevel 1 curl.exe -fsSL --connect-timeout 15 --max-time 120 "https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/tools/adb-bridge/scrcpy-mirror.js" -o "%MIRROR_TARGET%.tmp" >> "%LOG_FILE%" 2>&1
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing 'https://afra55.github.io/tools/adb-bridge/scrcpy-mirror.js' -OutFile '%MIRROR_TARGET%.tmp'; exit 0 } catch { try { Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/tools/adb-bridge/scrcpy-mirror.js' -OutFile '%MIRROR_TARGET%.tmp'; exit 0 } catch { exit 1 } }" >> "%LOG_FILE%" 2>&1
  )
  if exist "%MIRROR_TARGET%.tmp" move /Y "%MIRROR_TARGET%.tmp" "%MIRROR_TARGET%" >nul
)
if not exist "%MIRROR_TARGET%" (
  echo [ERROR] Missing scrcpy-mirror.js next to server.js
  echo Re-download the full ZIP and keep scrcpy-mirror.js in the same folder.
  echo [ERROR] missing scrcpy-mirror.js>> "%LOG_FILE%"
  exit /b 1
)
echo [OK] scrcpy-mirror.js ready>> "%LOG_FILE%"

rem Register custom URL protocol so the webpage can request start (devtools-bridge://start)
set "ADB_BRIDGE_DIR=%SCRIPT_DIR%"
reg add "HKCU\Software\Classes\devtools-bridge" /ve /d "URL:DevTools Bridge Protocol" /f >> "%LOG_FILE%" 2>&1
reg add "HKCU\Software\Classes\devtools-bridge" /v "URL Protocol" /d "" /f >> "%LOG_FILE%" 2>&1
reg add "HKCU\Software\Classes\devtools-bridge\shell\open\command" /ve /d "\"%~f0\"" /f >> "%LOG_FILE%" 2>&1
echo [OK] Registered protocol devtools-bridge:// >> "%LOG_FILE%"


set "EV_PROXY=%SCRIPT_DIR%everything-proxy.js"
if not exist "%EV_PROXY%" (
  echo [..] Downloading everything-proxy.js ...
  echo downloading everything-proxy.js>> "%LOG_FILE%"
  if exist "%EV_PROXY%.tmp" del /f /q "%EV_PROXY%.tmp" >nul 2>&1
  where curl >nul 2>&1
  if not errorlevel 1 (
    curl.exe -fsSL --connect-timeout 15 --max-time 120 "https://afra55.github.io/tools/adb-bridge/everything-proxy.js" -o "%EV_PROXY%.tmp" >> "%LOG_FILE%" 2>&1
    if errorlevel 1 curl.exe -fsSL --connect-timeout 15 --max-time 120 "https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/tools/adb-bridge/everything-proxy.js" -o "%EV_PROXY%.tmp" >> "%LOG_FILE%" 2>&1
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing 'https://afra55.github.io/tools/adb-bridge/everything-proxy.js' -OutFile '%EV_PROXY%.tmp'; exit 0 } catch { try { Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/tools/adb-bridge/everything-proxy.js' -OutFile '%EV_PROXY%.tmp'; exit 0 } catch { exit 1 } }" >> "%LOG_FILE%" 2>&1
  )
  if exist "%EV_PROXY%.tmp" move /Y "%EV_PROXY%.tmp" "%EV_PROXY%" >nul
)
if not exist "%EV_PROXY%" (
  echo [WARN] missing everything-proxy.js - Everything 搜索需重新下载完整 ZIP>> "%LOG_FILE%"
)

if not exist "%SCRIPT_DIR%ffmpeg-bridge\server.js" (
  echo [WARN] ffmpeg-bridge/server.js not found - FFmpeg API disabled until full ZIP is used.
  echo [WARN] missing ffmpeg-bridge>> "%LOG_FILE%"
)

if "%ADB_BRIDGE_TOKEN%"=="" set "ADB_BRIDGE_TOKEN=devtools-bridge"
set "ADB_BRIDGE_DIR=%CD%"

set "RESOLVE_SCRIPT=%SCRIPT_DIR%resolve-port.js"
set "ADB_BRIDGE_PORT="
set "PORT_MODE=READY"
set "PORT_FILE=%SCRIPT_DIR%.bridge-port.tmp"
if exist "%RESOLVE_SCRIPT%" (
  echo [..] Checking port availability...
  rem Redirect stdout only so prompts stay on this console; avoids for /f stealing stdin.
  node "%RESOLVE_SCRIPT%" > "%PORT_FILE%"
  if errorlevel 1 (
    echo [ERROR] Port resolve cancelled or failed.
    echo [ERROR] port resolve failed>> "%LOG_FILE%"
    if exist "%PORT_FILE%" del /f /q "%PORT_FILE%" >nul 2>&1
    exit /b 1
  )
  for /f "usebackq tokens=1,2" %%A in ("%PORT_FILE%") do (
    set "PORT_MODE=%%A"
    set "ADB_BRIDGE_PORT=%%B"
  )
  if exist "%PORT_FILE%" del /f /q "%PORT_FILE%" >nul 2>&1
)
if not defined ADB_BRIDGE_PORT set "ADB_BRIDGE_PORT=17888"
if /i "!PORT_MODE!"=="ALREADY" (
  echo [OK] Bridge already running on port !ADB_BRIDGE_PORT!
  echo      Do not open another bat/cmd. Keep the first window open, then click Connect on the webpage.
  echo already running port=!ADB_BRIDGE_PORT!>> "%LOG_FILE%"
  exit /b 0
)
echo [OK] Bridge port: %ADB_BRIDGE_PORT%
echo bridge port=%ADB_BRIDGE_PORT%>> "%LOG_FILE%"
echo ADB_BRIDGE_DIR=%ADB_BRIDGE_DIR%>> "%LOG_FILE%"

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
