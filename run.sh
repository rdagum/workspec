#!/usr/bin/env bash
# run.sh — OPTIONAL. The app runs by just double-clicking index.html (file://).
# This serves it over http://127.0.0.1 instead, which some Chrome versions treat
# as a friendlier secure context for File System Access write permission.
#
# This is only a static file host: it hands the browser the HTML/CSS/JS and runs
# none of the application logic. There is no backend, API, or database (PROMPT §3.1).
# Use a Chromium browser (Chrome/Edge) for the File System Access API.

set -euo pipefail

# Bind/serve on 127.0.0.1 explicitly. On Windows, "localhost" can resolve to the
# IPv6 ::1 first while Python's http.server listens on IPv4 only, which shows up
# in the browser as ERR_CONNECTION_REFUSED. 127.0.0.1 avoids that and is still a
# valid secure context for the File System Access API.
HOST="127.0.0.1"
PORT="${1:-9000}"
URL="http://${HOST}:${PORT}"

# Serve from the directory this script lives in.
cd "$(dirname "$0")"

echo "WorkSpec board → ${URL}"
echo "Open a Chromium browser and click 'Open .workspec folder'. Ctrl+C to stop."
echo

# Open the default browser (best-effort, per platform).
open_browser() {
  if command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "" "$URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 || true
  fi
}

# Pick whatever static server is available.
if command -v python3 >/dev/null 2>&1; then
  open_browser
  exec python3 -m http.server "$PORT" --bind "$HOST"
elif command -v python >/dev/null 2>&1; then
  open_browser
  exec python -m http.server "$PORT" --bind "$HOST"
elif command -v npx >/dev/null 2>&1; then
  open_browser
  exec npx --yes serve -l "tcp://${HOST}:${PORT}" .
else
  echo "Error: need python3, python, or npx (Node) to serve static files." >&2
  echo "Install one of them, or open the folder with VS Code 'Live Server'." >&2
  exit 1
fi
