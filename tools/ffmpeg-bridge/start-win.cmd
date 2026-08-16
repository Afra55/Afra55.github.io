@echo off
cd /d "%~dp0"
cmd /d /c ""%~dp0start-win.bat" & echo. & echo If the window closed too fast, open Desktop\devtools-ffmpeg-bridge-last-start.log & pause"
