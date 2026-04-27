@echo off
title Case Management System

cd /d "%~dp0"

echo.
echo  =============================================
echo    Case Management - Starting...
echo  =============================================
echo.

:: Find npm - check common Node.js installation paths
where npm >nul 2>&1
if %errorlevel% neq 0 (
    :: Try common install locations
    if exist "%ProgramFiles%\nodejs\npm.cmd" (
        set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
    ) else if exist "%ProgramFiles(x86)%\nodejs\npm.cmd" (
        set "PATH=%ProgramFiles(x86)%\nodejs;%APPDATA%\npm;%PATH%"
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

:: Install dependencies on first run
if not exist "node_modules" (
    echo  Step 1/2  Installing dependencies, please wait...
    echo.
    call npm install --registry=https://registry.npmmirror.com
    if errorlevel 1 (
        echo.
        echo  [ERROR] npm install failed.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo  Done.
    echo.
)

echo  Step 2/2  Starting dev server...
echo.
echo  URL  :  http://localhost:5173
echo  Stop :  Close this window
echo.
echo  =============================================
echo.

:: Open browser after 2 second delay
start /min "" cmd /c "timeout /t 2 >nul && start http://localhost:5173"

:: Start dev server (blocks until window is closed)
npm run dev

pause
