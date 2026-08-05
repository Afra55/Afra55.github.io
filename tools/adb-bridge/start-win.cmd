@echo off
cd /d "%~dp0"
rem Wrapper keeps console open even if the .bat parser fails mid-way.
cmd /d /c ""%~dp0start-win.bat" & echo. & echo If the window closed too fast, open Desktop\devtools-adb-bridge-last-start.log & pause"
