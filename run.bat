@echo off
title TrimFast Web App Launcher

cd /d "%~dp0"

echo ===================================================
echo   Starting TrimFast App
echo ===================================================
echo.

set "PYTHON_CMD=python"

python --version >nul 2>nul
if %errorlevel% equ 0 goto RUN_SERVER

python3 --version >nul 2>nul
if %errorlevel% equ 0 (
    set "PYTHON_CMD=python3"
    goto RUN_SERVER
)

if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" (
    set "PYTHON_CMD=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
    goto RUN_SERVER
)

if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    set "PYTHON_CMD=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    goto RUN_SERVER
)

echo [ERROR] Python execution failed.
pause
exit /b 1

:RUN_SERVER
echo Opening website http://localhost:5000 in browser...
start http://localhost:5000

echo.
echo ===================================================
echo  TrimFast is running on http://localhost:5000
echo  Press Ctrl+C to stop the server.
echo ===================================================
echo.

"%PYTHON_CMD%" app.py

pause
