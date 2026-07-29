#!/usr/bin/env bash
# ==========================================
#    مزرعه و شهر  —  Farm & City
#    Double-click to play (macOS / Linux)
# ==========================================
cd "$(dirname "$0")" || exit 1

PORT=8731

echo
echo "  =========================================="
echo "     MAZRAE & SHAHR   -   FARM & CITY"
echo "  =========================================="
echo

# Serve the folder over http so the browser allows saved games.
PY=""
command -v python3 >/dev/null 2>&1 && PY="python3"
[ -z "$PY" ] && command -v python >/dev/null 2>&1 && PY="python"

open_url() {
  if command -v open >/dev/null 2>&1; then open "$1"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1"
  else echo "  Open this in your browser: $1"
  fi
}

if [ -z "$PY" ]; then
  echo "  Python was not found, opening the game file directly."
  echo "  (Everything works, but the browser may block saved games.)"
  open_url "file://$PWD/index.html"
  sleep 3
  exit 0
fi

# Step to a free port if this one is taken
for _ in 0 1 2 3 4 5; do
  if ! (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; then break; fi
  exec 3>&- 2>/dev/null
  PORT=$((PORT + 1))
done

echo "  Starting on port $PORT ..."
"$PY" -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM
sleep 1

open_url "http://127.0.0.1:$PORT/index.html"
echo "  The game is opening in your browser."
echo "  Keep this window open while you play. Press Ctrl+C to stop."
echo
wait $SERVER
