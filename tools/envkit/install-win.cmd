@echo off
setlocal
cd /d "%~dp0"
echo DevTools EnvKit
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-devtools-env.ps1" %*
echo.
pause
