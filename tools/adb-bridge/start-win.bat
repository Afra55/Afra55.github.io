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

rem Unified bridge also needs scrcpy-mirror.js (and optional ffmpeg module) beside server.js
set "MIRROR_LOCAL=%SCRIPT_DIR%scrcpy-mirror.js"
set "MIRROR_TARGET=%BRIDGE_DIR%\scrcpy-mirror.js"
if exist "%MIRROR_LOCAL%" (
  copy /Y "%MIRROR_LOCAL%" "%MIRROR_TARGET%" >nul
  echo [OK] scrcpy-mirror.js synced>> "%LOG_FILE%"
)
if exist "%SCRIPT_DIR%ffmpeg-bridge\server.js" (
  if not exist "%BRIDGE_DIR%\ffmpeg-bridge" mkdir "%BRIDGE_DIR%\ffmpeg-bridge" 2>nul
  copy /Y "%SCRIPT_DIR%ffmpeg-bridge\server.js" "%BRIDGE_DIR%\ffmpeg-bridge\server.js" >nul
  echo [OK] ffmpeg-bridge synced>> "%LOG_FILE%"
)
if exist "%SCRIPT_DIR%vendor\scrcpy-server-v3.1" (
  if not exist "%BRIDGE_DIR%\vendor" mkdir "%BRIDGE_DIR%\vendor" 2>nul
  copy /Y "%SCRIPT_DIR%vendor\scrcpy-server-v3.1" "%BRIDGE_DIR%\vendor\scrcpy-server-v3.1" >nul
  echo [OK] scrcpy vendor synced>> "%LOG_FILE%"
)
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
if not exist "%BRIDGE_DIR%\ffmpeg-bridge\server.js" (
  echo [WARN] ffmpeg-bridge/server.js not found - FFmpeg API disabled until full ZIP is used.
  echo [WARN] missing ffmpeg-bridge>> "%LOG_FILE%"
)

if exist "%SCRIPT_DIR%resolve-port.js" (
  copy /Y "%SCRIPT_DIR%resolve-port.js" "%BRIDGE_DIR%\resolve-port.js" >nul
  echo [OK] resolve-port.js synced>> "%LOG_FILE%"
)

cd /d "%BRIDGE_DIR%"
if "%ADB_BRIDGE_TOKEN%"=="" set "ADB_BRIDGE_TOKEN=devtools-bridge"

set "RESOLVE_SCRIPT=%SCRIPT_DIR%resolve-port.js"
if not exist "%RESOLVE_SCRIPT%" set "RESOLVE_SCRIPT=%BRIDGE_DIR%\resolve-port.js"
set "ADB_BRIDGE_PORT="
if exist "%RESOLVE_SCRIPT%" (
  echo [..] Checking port availability...
  for /f "usebackq delims=" %%P in (`node "%RESOLVE_SCRIPT%"`) do set "ADB_BRIDGE_PORT=%%P"
  if errorlevel 1 (
    echo [ERROR] Port resolve cancelled or failed.
    echo [ERROR] port resolve failed>> "%LOG_FILE%"
    exit /b 1
  )
)
if not defined ADB_BRIDGE_PORT set "ADB_BRIDGE_PORT=17888"
echo [OK] Bridge port: %ADB_BRIDGE_PORT%
echo bridge port=%ADB_BRIDGE_PORT%>> "%LOG_FILE%"

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
