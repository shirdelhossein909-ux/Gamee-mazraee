@echo off
rem =====================================================================
rem   کِشتوَر — Keshtvar
rem
rem   Double-click to play. This relaunches itself hidden, so no black
rem   console window sits on screen while you play, then opens the game
rem   in its own app window — no tabs, no address bar — when Chrome,
rem   Edge or Brave is installed.
rem =====================================================================

rem --- second pass: the real work, running hidden ---
if "%~1"=="--run" goto RUN

rem --- first pass: hide ourselves and re-enter ---
cd /d "%~dp0"
> "%~dp0.launch.vbs" echo Set s = CreateObject("Wscript.Shell")
>>"%~dp0.launch.vbs" echo s.Run """%~f0"" --run", 0, False
start "" /min wscript.exe "%~dp0.launch.vbs"
exit /b

:RUN
cd /d "%~dp0"
del "%~dp0.launch.vbs" >nul 2>nul

set PORT=8731
set PY=
where py       >nul 2>nul && set PY=py -3
if "%PY%"==""  (where python  >nul 2>nul && set PY=python)
if "%PY%"==""  (where python3 >nul 2>nul && set PY=python3)

rem --- a browser we can open in app mode: own window, no browser UI ---
set BROWSER=
for %%B in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"
) do if not defined BROWSER if exist %%B set BROWSER=%%B

if "%PY%"=="" goto NOSERVER

rem serve quietly in the background so the browser allows saved games
start "" /b %PY% -m http.server %PORT% --bind 127.0.0.1 >nul 2>nul
rem let the socket come up before pointing a window at it
ping -n 2 127.0.0.1 >nul
set URL=http://127.0.0.1:%PORT%/index.html
goto OPEN

:NOSERVER
rem no Python: open the file directly. It all plays, but the browser may
rem refuse to keep saved games on file://
set URL=file:///%~dp0index.html
set URL=%URL:\=/%

:OPEN
if defined BROWSER (
  start "" %BROWSER% --app="%URL%" --window-size=1600,900
) else (
  start "" "%URL%"
)
exit /b
