@echo off
chcp 65001 >nul
title مزرعه و شهر - Farm ^& City
cd /d "%~dp0"

echo.
echo   ============================================
echo     MAZRAE ^& SHAHR  -  FARM ^& CITY
echo   ============================================
echo.

rem A tiny local web server is used so the browser lets the game save
rem your progress. If no Python is installed we just open the file
rem directly - the game still runs, only the save slot may be blocked.

set PORT=8731
set PY=

where py >nul 2>nul && set PY=py -3
if "%PY%"=="" (where python >nul 2>nul && set PY=python)
if "%PY%"=="" (where python3 >nul 2>nul && set PY=python3)

if "%PY%"=="" goto NOPYTHON

echo   Starting local server on port %PORT% ...
start "" "http://127.0.0.1:%PORT%/index.html"
echo   The game is opening in your browser.
echo   Keep this window open while you play. Close it to stop.
echo.
%PY% -m http.server %PORT% --bind 127.0.0.1
goto END

:NOPYTHON
echo   Python was not found, opening the game file directly.
echo   (Everything works, but the browser may block saved games.)
echo.
start "" "index.html"
timeout /t 4 >nul

:END
