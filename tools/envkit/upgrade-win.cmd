@echo off
setlocal
cd /d "%~dp0"
echo DevTools 一键升级（系统工具 + 桥）
echo.
if exist "%~dp0install-devtools-env.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-devtools-env.ps1" -Mode upgrade
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0upgrade-devtools-env.ps1"
)
echo.
pause
