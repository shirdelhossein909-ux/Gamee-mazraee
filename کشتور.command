#!/usr/bin/env bash
# ============================================================
#    کِشتوَر  —  Keshtvar
#    Double-click to play (macOS / Linux)
#
#    Opens the game in its own window — no tabs, no address bar —
#    and closes this terminal window behind itself. No web server
#    and no helper files: the game keeps its saves in the browser
#    profile handed to it below.
# ============================================================
cd "$(dirname "$0")" || exit 1

# tidy up the helper an older version used to leave behind
rm -f ./.launch.vbs 2>/dev/null

URL="file://$PWD/index.html"
PROFILE="$HOME/.keshtvar/browser"

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

BROWSER="$(find_browser)"
if [ -n "$BROWSER" ]; then
  mkdir -p "$PROFILE"
  nohup "$BROWSER" --app="$URL" --user-data-dir="$PROFILE" \
    --allow-file-access-from-files --window-size=1600,900 >/dev/null 2>&1 &
  disown 2>/dev/null
elif command -v open >/dev/null 2>&1; then
  open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL"
else
  echo "Open this in your browser: $URL"
  sleep 5
fi

# close the Terminal window this script opened (macOS)
if command -v osascript >/dev/null 2>&1; then
  osascript -e 'tell application "Terminal" to close (every window whose name contains "کشتور")' \
    >/dev/null 2>&1 &
fi
exit 0
