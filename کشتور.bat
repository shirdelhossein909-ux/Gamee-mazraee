@echo off
rem =====================================================================
rem   کِشتوَر — Keshtvar
rem
rem   Double-click to play. The game opens in its own window — no tabs,
rem   no address bar — and this console closes straight away.
rem
rem   An earlier version wrote a small .vbs helper to relaunch itself
rem   hidden. `echo` writes through the console codepage, so a folder
rem   name with Persian characters came out mangled and Windows Script
rem   Host reported "cannot find the file specified". Nothing is written
rem   to disk here any more: every path goes straight to CreateProcess,
rem   which is Unicode end to end.
rem =====================================================================

rem clear away the helper the old version left behind
if exist "%~dp0.launch.vbs" del /f /q "%~dp0.launch.vbs" >nul 2>nul

rem file:// is enough on its own — saves live in the browser profile
rem below, so there is no local web server and no Python needed.
set "URL=file:///%~dp0index.html"
set "URL=%URL:\=/%"

rem The game gets its own browser profile on an ASCII path, so it always
rem opens a clean window and never disturbs your normal browsing.
set "PROFILE=%LOCALAPPDATA%\Keshtvar\browser"

rem %ProgramFiles(x86)% is copied out first: the ")" in its name breaks
rem batch parsing if it is ever undefined inside a block.
set "PF=%ProgramFiles%"
set "PF86=%ProgramFiles(x86)%"
set "LAD=%LocalAppData%"

rem A Chromium-family browser gives us --app: a bare window, no browser UI.
set "BROWSER="
call :pick "%PF%\Google\Chrome\Application\chrome.exe"
call :pick "%PF86%\Google\Chrome\Application\chrome.exe"
call :pick "%LAD%\Google\Chrome\Application\chrome.exe"
call :pick "%PF%\Microsoft\Edge\Application\msedge.exe"
call :pick "%PF86%\Microsoft\Edge\Application\msedge.exe"
call :pick "%PF%\BraveSoftware\Brave-Browser\Application\brave.exe"
call :pick "%LAD%\BraveSoftware\Brave-Browser\Application\brave.exe"

if not defined BROWSER goto PLAIN

start "" "%BROWSER%" --app="%URL%" --user-data-dir="%PROFILE%" --allow-file-access-from-files --window-size=1600,900
exit

:PLAIN
rem no Chromium-family browser installed: hand it to whatever opens .html
start "" "%~dp0index.html"
exit

:pick
if defined BROWSER goto :eof
if exist %1 set "BROWSER=%~1"
goto :eof
