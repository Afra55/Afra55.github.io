@echo off
chcp 65001 >nul
setlocal
echo DevTools ADB Bridge 启动中...
echo 使用本工具需要本机已安装 adb，并可用：adb devices
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo 未找到 node。请先安装 Node.js：https://nodejs.org/
  pause
  exit /b 1
)

where adb >nul 2>&1
if errorlevel 1 (
  echo 未找到 adb。请安装 Android platform-tools，并确保 adb 在 PATH 中。
  pause
  exit /b 1
)

set "BRIDGE_DIR=%USERPROFILE%\.devtools-adb-bridge"
if not exist "%BRIDGE_DIR%" mkdir "%BRIDGE_DIR%"
if "%ADB_BRIDGE_BASE_URL%"=="" set "ADB_BRIDGE_BASE_URL=https://afra55.github.io/tools/adb-bridge"

set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%server.js" (
  copy /Y "%SCRIPT_DIR%server.js" "%BRIDGE_DIR%\server.js" >nul
) else (
  echo 正在下载桥接服务：%ADB_BRIDGE_BASE_URL%/server.js
  powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing '%ADB_BRIDGE_BASE_URL%/server.js' -OutFile '%BRIDGE_DIR%\server.js'"
  if errorlevel 1 (
    echo 下载 server.js 失败
    pause
    exit /b 1
  )
)

cd /d "%BRIDGE_DIR%"
if "%ADB_BRIDGE_TOKEN%"=="" set "ADB_BRIDGE_TOKEN=devtools-adb"
if "%ADB_BRIDGE_PORT%"=="" set "ADB_BRIDGE_PORT=17888"
echo adb 版本：
adb version
echo.
node server.js
echo.
pause
