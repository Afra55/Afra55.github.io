@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo DevTools EnvKit - upgrade (tools + bridge)
echo.
if exist "%~dp0install-devtools-env.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-devtools-env.ps1" -Mode upgrade
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0upgrade-devtools-env.ps1"
)
echo.
pause
