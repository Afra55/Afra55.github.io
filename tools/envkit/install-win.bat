@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo DevTools EnvKit - install
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-devtools-env.ps1" %*
echo.
pause
