@echo off
cd /d "%~dp0"
rem Wrapper keeps console open even if the .bat parser fails mid-way.
rem Only open THIS .cmd (or only the .bat) — not both, or you used to get two bridges.
cmd /d /c ""%~dp0start-win.bat" & echo. & echo If the window closed too fast, open last-start.log in this folder & pause"
