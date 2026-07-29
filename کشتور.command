#!/usr/bin/env bash
# ============================================================
#    کِشتوَر  —  Keshtvar
#    Double-click to play (macOS / Linux)
#
#    Opens the game in its own app window — no tabs, no address
#    bar — when Chrome, Edge or Brave is installed, and closes
#    its own terminal window once the game is up.
# ============================================================
cd "$(dirname "$0")" || exit 1
PORT=8731

PY=""
command -v python3 >/dev/null 2>&1 && PY="python3"
[ -z "$PY" ] && command -v python >/dev/null 2>&1 && PY="python"

# A browser that supports --app=, so the game gets a bare window
find_browser() {
  local c
  for c in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
    "$(command -v google-chrome 2>/dev/null)" \
    "$(command -v google-chrome-stable 2>/dev/null)" \
    "$(command -v chromium 2>/dev/null)" \
    "$(command -v chromium-browser 2>/dev/null)" \
    "$(command -v microsoft-edge 2>/dev/null)" \
    "$(command -v brave-browser 2>/dev/null)"
  do
    [ -n "$c" ] && [ -x "$c" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}

open_plain() {
  if command -v open >/dev/null 2>&1; then open "$1"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1"
  else echo "  Open this in your browser: $1"; fi
}

if [ -z "$PY" ]; then
  URL="file://$PWD/index.html"
else
  # step to a free port if this one is busy
  for _ in 0 1 2 3 4 5; do
    (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null || break
    exec 3>&- 2>/dev/null
    PORT=$((PORT + 1))
  done
  # serve quietly, detached, so closing this window does not kill the game
  nohup "$PY" -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
  disown 2>/dev/null
  sleep 1
  URL="http://127.0.0.1:$PORT/index.html"
fi

BROWSER="$(find_browser)"
if [ -n "$BROWSER" ]; then
  nohup "$BROWSER" --app="$URL" --window-size=1600,900 >/dev/null 2>&1 &
  disown 2>/dev/null
else
  open_plain "$URL"
fi

# On macOS, close the Terminal window this script opened.
if command -v osascript >/dev/null 2>&1; then
  osascript -e 'tell application "Terminal" to close (every window whose name contains "کشتور")' \
    >/dev/null 2>&1 &
fi
exit 0
