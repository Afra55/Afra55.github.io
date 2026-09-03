@echo off
cd /d "%~dp0"
rem Wrapper keeps console open even if the .bat parser fails mid-way.
rem Protocol launch (devtools-bridge://) must not leave a second paused window.
echo %* | findstr /I "devtools-bridge:" >nul 2>&1
if not errorlevel 1 (
  cmd /d /c ""%~dp0start-win.bat" %*"
  exit /b %ERRORLEVEL%
)
cmd /d /c ""%~dp0start-win.bat" & echo. & echo If the window closed too fast, open last-start.log in this folder & pause"
