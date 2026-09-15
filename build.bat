@echo off
REM Rebuilds GMapLeadsGen.exe from gui.py. Run this after changing gui.py.

cd /d "%~dp0"

python -m PyInstaller --onefile --windowed --name GMapLeadsGen gui.py
if errorlevel 1 (
    echo Build failed.
    exit /b 1
)

copy /y dist\GMapLeadsGen.exe GMapLeadsGen.exe >nul
rmdir /s /q build
rmdir /s /q dist
del /q GMapLeadsGen.spec

echo Done. GMapLeadsGen.exe rebuilt.
