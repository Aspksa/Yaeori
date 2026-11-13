@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Yaeori

rem ASCII-only CMD bootstrap; avoid Unicode before setting a compatible code page.
cd /d "%~dp0"
if errorlevel 1 goto folder_error
if not exist "scripts\launch.mjs" goto folder_error

set "ROOT=%CD%"
set "RUNTIME=%ROOT%\.runtime"
set "NODE_DIR=%RUNTIME%\node"

call :check_node
if not errorlevel 1 goto have_node

if exist "%NODE_DIR%\node.exe" (
  set "PATH=%NODE_DIR%;%PATH%"
  call :check_node
  if not errorlevel 1 goto have_node
)

echo Node.js 20+ not found. Downloading portable runtime...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\bootstrap-node.ps1" -Dest "%RUNTIME%"
if errorlevel 1 goto node_error
set "PATH=%NODE_DIR%;%PATH%"
call :check_node
if errorlevel 1 goto node_error

:have_node
chcp 65001 >nul
node -v
node "%ROOT%\scripts\launch.mjs" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" goto launch_error
exit /b 0

:folder_error
echo [ERROR] Cannot open Yaeori folder or scripts\launch.mjs is missing.
echo Put Yaeori.bat in the extracted project folder.
pause
exit /b 1

:node_error
echo [ERROR] Node.js bootstrap failed. Check internet or install Node.js 20+.
pause
exit /b 1

:launch_error
echo.
echo [ERROR] Yaeori exited with code %RC%.
pause
exit /b %RC%

:check_node
node -e "process.exit(Number(process.versions.node.split('.')[0])>=20?0:1)" >nul 2>&1
exit /b %ERRORLEVEL%
