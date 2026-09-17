@echo off
title NguonC Stremio Add-on
echo ==============================================
echo   NguonC - Stremio Add-on
echo ==============================================
echo.
echo Kiem tra Node.js...
node --version
if errorlevel 1 (
  echo.
  echo CHUA CAI NODE.JS.
  echo Hay cai Node.js 18+ roi chay lai file nay.
  pause
  exit /b 1
)

echo.
echo Cai dependencies...
call npm install

echo.
echo Khoi dong Add-on...
call npm start
pause
