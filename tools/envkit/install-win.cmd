@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "BASE=https://afra55.github.io/tools/envkit"
set "PS1=%~dp0install-devtools-env.ps1"
if not exist "%PS1%" (
  echo Fetching install-devtools-env.ps1 ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%BASE%/install-devtools-env.ps1' -OutFile '%PS1%' } catch { Write-Host ('download failed: ' + $_.Exception.Message); exit 1 }"
)
if not exist "%PS1%" (
  echo [ERROR] could not fetch install-devtools-env.ps1
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
echo.
pause
