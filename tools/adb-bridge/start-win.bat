@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem Prefer keeping the window open on any failure (avoid flash-close).

cd /d "%~dp0" 2>nul
echo DevTools ADB Bridge 启动中...
echo 使用本工具需要本机已安装 adb，并可用：adb devices
echo.

set "BRIDGE_DIR=%USERPROFILE%\.devtools-adb-bridge"
if not exist "%BRIDGE_DIR%" mkdir "%BRIDGE_DIR%"
set "LOG_FILE=%BRIDGE_DIR%\last-start.log"
set "SCRIPT_DIR=%~dp0"
set "TARGET=%BRIDGE_DIR%\server.js"
if "%ADB_BRIDGE_BASE_URL%"=="" set "ADB_BRIDGE_BASE_URL=https://afra55.github.io/tools/adb-bridge"

echo ==== %DATE% %TIME% ==== > "%LOG_FILE%"
echo SCRIPT_DIR=%SCRIPT_DIR%>> "%LOG_FILE%"
where node >> "%LOG_FILE%" 2>&1
where adb >> "%LOG_FILE%" 2>&1

where node >nul 2>&1
if errorlevel 1 (
  echo 未找到 node。请先安装 Node.js：https://nodejs.org/
  echo 若已安装，请重新打开终端或把 node 加入 PATH。
  echo 日志：%LOG_FILE%
  goto :fail
)

where adb >nul 2>&1
if errorlevel 1 (
  echo 未找到 adb。请安装 Android platform-tools，并确保 adb 在 PATH 中。
  echo 日志：%LOG_FILE%
  goto :fail
)

set "HAVE_SERVER=0"
if exist "%SCRIPT_DIR%server.js" (
  findstr /I /C:"ADB_BRIDGE_TOKEN" /C:"devtools-adb-bridge" /C:"DevTools local ADB bridge" "%SCRIPT_DIR%server.js" >nul 2>&1
  if not errorlevel 1 (
    copy /Y "%SCRIPT_DIR%server.js" "%TARGET%" >nul
    echo 已使用同目录 server.js
    set "HAVE_SERVER=1"
  )
)

if "!HAVE_SERVER!"=="0" if exist "%TARGET%" (
  findstr /I /C:"ADB_BRIDGE_TOKEN" /C:"devtools-adb-bridge" /C:"DevTools local ADB bridge" "%TARGET%" >nul 2>&1
  if not errorlevel 1 (
    echo 已使用本地缓存：%TARGET%
    set "HAVE_SERVER=1"
  )
)

if "!HAVE_SERVER!"=="0" (
  echo 正在下载桥接服务…
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $urls=@('%ADB_BRIDGE_BASE_URL%/server.js','https://afra55.github.io/tools/adb-bridge/server.js','https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/tools/adb-bridge/server.js'); $out='%TARGET%'; $ok=$false; foreach($u in $urls){ try { Write-Host ('尝试: ' + $u); Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile ($out + '.tmp') -TimeoutSec 120; $t=Get-Content -Raw ($out + '.tmp'); if($t -match 'ADB_BRIDGE_TOKEN|devtools-adb-bridge|DevTools local ADB bridge'){ Move-Item -Force ($out + '.tmp') $out; $ok=$true; break } else { Remove-Item -Force ($out + '.tmp') -ErrorAction SilentlyContinue } } catch { Remove-Item -Force ($out + '.tmp') -ErrorAction SilentlyContinue; Write-Host ('失败: ' + $_.Exception.Message) } }; if(-not $ok){ exit 1 }; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
  if errorlevel 1 (
    echo.
    echo 无法获取 server.js（桥接服务主文件）。
    echo 请回到网页重新下载「完整 ZIP 包」，解压后确保与启动脚本同目录有 server.js，再运行。
    echo 日志：%LOG_FILE%
    goto :fail
  )
  echo 下载完成
)

if not exist "%TARGET%" (
  echo 找不到 server.js：%TARGET%
  echo 日志：%LOG_FILE%
  goto :fail
)

cd /d "%BRIDGE_DIR%"
if "%ADB_BRIDGE_TOKEN%"=="" set "ADB_BRIDGE_TOKEN=devtools-adb"
if "%ADB_BRIDGE_PORT%"=="" set "ADB_BRIDGE_PORT=17888"
echo adb 版本：
adb version
echo.
echo 启动桥：%TARGET%
echo 若失败请查看日志：%LOG_FILE%
echo.

node server.js
set "CODE=!ERRORLEVEL!"
echo node exit=!CODE!>> "%LOG_FILE%"
echo.
if not "!CODE!"=="0" (
  echo 桥进程退出，代码 !CODE!。请向上滚动查看错误。
  echo 日志：%LOG_FILE%
  goto :fail
)

echo 桥已退出。
pause
exit /b 0

:fail
echo.
pause
exit /b 1
