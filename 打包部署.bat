@echo off
title Case Management - Build and Pack for Deploy

cd /d "%~dp0"

echo.
echo  =============================================
echo    Case Management - Build and Pack
echo  =============================================
echo.

:: Find npm
where npm >nul 2>&1
if %errorlevel% neq 0 (
    if exist "%ProgramFiles%\nodejs\npm.cmd" (
        set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
    ) else if exist "%LOCALAPPDATA%\Programs\nodejs\npm.cmd" (
        set "PATH=%LOCALAPPDATA%\Programs\nodejs;%APPDATA%\npm;%PATH%"
    ) else (
        echo  [ERROR] Node.js not found.
        echo  Please install Node.js from: https://nodejs.org
        echo.
        pause
        exit /b 1
    )
)

:: Step 1/3 - npm install (only if node_modules missing)
if not exist "node_modules" (
    echo  Step 1/3  Installing dependencies, please wait...
    echo  ---------------------------------------------
    call npm install --registry=https://registry.npmmirror.com
    if errorlevel 1 (
        echo.
        echo  [ERROR] npm install failed.
        echo.
        pause
        exit /b 1
    )
    echo.
) else (
    echo  Step 1/3  Dependencies already installed, skipped.
    echo.
)

:: Step 2/3 - Build frontend (dist/)
echo  Step 2/3  Building frontend...
echo  ---------------------------------------------
call npm run build
if errorlevel 1 (
    echo.
    echo  [ERROR] Frontend build failed. Check messages above.
    echo.
    pause
    exit /b 1
)
echo.

:: Step 3/3 - Prepare .env.production + pack zip (PowerShell helper)
echo  Step 3/3  Preparing .env.production and packing zip...
echo  ---------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -File pack-deploy-helper.ps1
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Pack failed. Check messages above.
    echo.
    pause
    exit /b 1
)

echo.
echo  =============================================
echo    Done
echo  =============================================
echo.
echo  Next steps:
echo    1. Upload case-management-v1.1.zip to an object storage / file host
echo    2. Get a temporary signed URL (e.g. 1 hour expiry)
echo    3. SSH to your server and run the deploy commands
echo       (see docs folder for full deployment guide)
echo.

pause
exit /b 0
