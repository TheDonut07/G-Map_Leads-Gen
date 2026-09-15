@echo off
setlocal

echo Checking for Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo Node.js was not found on this machine.
    echo Install it from https://nodejs.org/ ^(LTS version^), then re-run this file.
    pause
    exit /b 1
)

echo Node.js found.
echo.
echo Installing project dependencies...
call npm install
if errorlevel 1 (
    echo.
    echo npm install failed. See the errors above.
    pause
    exit /b 1
)

echo.
echo Checking for Playwright's Chromium browser...
node -e "const {chromium}=require('playwright');const fs=require('fs');process.exit(fs.existsSync(chromium.executablePath())?0:1);" >nul 2>nul
if errorlevel 1 (
    echo Chromium not found. Installing ^(this can take a few minutes^)...
    call npx playwright install chromium
    if errorlevel 1 (
        echo.
        echo Playwright browser install failed. See the errors above.
        pause
        exit /b 1
    )
) else (
    echo Chromium is already installed. Skipping download.
)

echo.
echo Setup complete. You can now run GMapLeadsGen.exe.
pause
