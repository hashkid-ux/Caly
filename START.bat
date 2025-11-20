@echo off
REM Quick setup script for Hindi AI Calling System

echo.
echo ===================================
echo  Hindi AI Calling System - Android Fix
echo ===================================
echo.
echo This script will:
echo 1. Start the backend on port 3000
echo 2. Show you how to test on mobile
echo.

REM Check if Node is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found! Please install Node.js first.
    pause
    exit /b 1
)

REM Build backend
echo [1/2] Building backend...
cd /d d:\caly\backend
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: Backend build failed!
    pause
    exit /b 1
)

REM Start backend
echo.
echo [2/2] Starting backend server...
echo.
echo ✅ Backend starting on port 3000
echo.
echo Next steps:
echo.
echo FOR MOBILE (Android/iOS):
echo ════════════════════════════════════
echo 1. Open NEW terminal and run:
echo    cd d:\caly\frontend
echo    npx ngrok http 5173
echo.
echo 2. ngrok will show you a URL like:
echo    https://abc-xyz.ngrok-free.app
echo.
echo 3. Open that URL on your phone
echo    ✅ Microphone will work (HTTPS)
echo.
echo FOR DESKTOP (Same Network):
echo ════════════════════════════════════
echo 1. Open browser: http://192.168.29.53:5173
echo 2. Microphone will work (local network)
echo.
echo FOR TESTING CONNECTION:
echo ════════════════════════════════════
echo 1. Visit: http://192.168.29.53:5173/test.html
echo 2. Check browser console (F12)
echo 3. Should see: ✅ CONNECTED
echo.
pause

cd /d d:\caly\backend
node dist/index.js
