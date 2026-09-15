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

echo.
echo Packaging files to share...

set PKG_DIR=GMapLeadsGen-package
if exist "%PKG_DIR%" rmdir /s /q "%PKG_DIR%"
mkdir "%PKG_DIR%"

copy /y GMapLeadsGen.exe "%PKG_DIR%\" >nul
copy /y scraper.js "%PKG_DIR%\" >nul
copy /y package.json "%PKG_DIR%\" >nul
copy /y package-lock.json "%PKG_DIR%\" >nul
copy /y setup.bat "%PKG_DIR%\" >nul

if exist GMapLeadsGen.zip del /q GMapLeadsGen.zip
powershell -NoProfile -Command "Compress-Archive -Path '%PKG_DIR%\*' -DestinationPath 'GMapLeadsGen.zip' -Force"

rmdir /s /q "%PKG_DIR%"

echo Done. GMapLeadsGen.exe rebuilt and GMapLeadsGen.zip packaged for sharing.
