@echo off
chcp 65001 >nul
setlocal EnableExtensions
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
set "SCRIPT_DIR=%~dp0"
set "TARGET=%BRIDGE_DIR%\server.js"
if "%ADB_BRIDGE_BASE_URL%"=="" set "ADB_BRIDGE_BASE_URL=https://afra55.github.io/tools/adb-bridge"

set "HAVE_SERVER=0"
if exist "%SCRIPT_DIR%server.js" (
  findstr /C:"ADB_BRIDGE_TOKEN" /C:"devtools-adb-bridge" /C:"DevTools local ADB bridge" "%SCRIPT_DIR%server.js" >nul 2>&1
  if not errorlevel 1 (
    copy /Y "%SCRIPT_DIR%server.js" "%TARGET%" >nul
    echo 已使用同目录 server.js
    set "HAVE_SERVER=1"
  )
)

if "%HAVE_SERVER%"=="0" if exist "%TARGET%" (
  findstr /C:"ADB_BRIDGE_TOKEN" /C:"devtools-adb-bridge" /C:"DevTools local ADB bridge" "%TARGET%" >nul 2>&1
  if not errorlevel 1 (
    echo 已使用本地缓存：%TARGET%
    set "HAVE_SERVER=1"
  )
)

if "%HAVE_SERVER%"=="0" (
  echo 正在下载桥接服务…
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$urls=@('%ADB_BRIDGE_BASE_URL%/server.js','https://afra55.github.io/tools/adb-bridge/server.js','https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/tools/adb-bridge/server.js'); ^
     $out='%TARGET%'; $ok=$false; ^
     foreach($u in $urls){ ^
       try { ^
         Write-Host ('尝试: ' + $u); ^
         Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile ($out + '.tmp') -TimeoutSec 120; ^
         $t=Get-Content -Raw ($out + '.tmp'); ^
         if($t -match 'ADB_BRIDGE_TOKEN|devtools-adb-bridge|DevTools local ADB bridge'){ ^
           Move-Item -Force ($out + '.tmp') $out; $ok=$true; break ^
         } else { Remove-Item -Force ($out + '.tmp') -ErrorAction SilentlyContinue } ^
       } catch { Remove-Item -Force ($out + '.tmp') -ErrorAction SilentlyContinue; Write-Host ('失败: ' + $_.Exception.Message) } ^
     }; ^
     if(-not $ok){ exit 1 }"
  if errorlevel 1 (
    echo.
    echo 无法获取 server.js（桥接服务主文件）。
    echo 请回到网页重新下载「完整 ZIP 包」，解压后确保与启动脚本同目录有 server.js，再运行。
    pause
    exit /b 1
  )
  echo 下载完成
)

if not exist "%TARGET%" (
  echo 找不到 server.js：%TARGET%
  pause
  exit /b 1
)

cd /d "%BRIDGE_DIR%"
if "%ADB_BRIDGE_TOKEN%"=="" set "ADB_BRIDGE_TOKEN=devtools-adb"
if "%ADB_BRIDGE_PORT%"=="" set "ADB_BRIDGE_PORT=17888"
echo adb 版本：
adb version
echo.
echo 启动桥：%TARGET%
node server.js
echo.
pause
