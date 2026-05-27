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

:: Step 1/3 - Install dependencies on first run
if not exist "node_modules" (
    echo  Step 1/3  Installing dependencies, please wait...
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
) else (
    echo  Step 1/3  Dependencies already installed, skipped.
    echo.
)

:: Step 2/3 - Ensure PostgreSQL is up and database schema is current
::            All three commands below are idempotent: safe to run on every start.
echo  Step 2/3  Preparing database...
echo.

:: 2a) Start PostgreSQL container (no-op if already running)
call npm run db:up
if errorlevel 1 (
    echo.
    echo  [ERROR] Failed to start PostgreSQL.
    echo  Please make sure Docker Desktop is running.
    echo.
    pause
    exit /b 1
)

:: 2b) Wait for PostgreSQL to accept connections
node scripts/wait-pg.js
if errorlevel 1 (
    echo.
    echo  [ERROR] PostgreSQL did not become ready in time.
    echo.
    pause
    exit /b 1
)

:: 2c) Apply pending migrations (already-applied ones are skipped)
call npm run db:migrate
if errorlevel 1 (
    echo.
    echo  [ERROR] Database migration failed.
    echo.
    pause
    exit /b 1
)

:: 2d) Seed initial superadmin if needed (idempotent: skips if superadmin already exists)
call node server/seed.js
if errorlevel 1 (
    echo.
    echo  [WARN] Seed step had an issue, but continuing.
    echo.
)

echo.
echo  Database is ready.
echo.

:: Step 3/3 - Start dev server
echo  Step 3/3  Starting dev server...
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
