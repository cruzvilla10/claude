#!/usr/bin/env bash
# Launch the craps table game in your browser.
# Usage: ./launch.sh
set -e

cd "$(dirname "$0")"
PORT="${PORT:-8000}"
URL="http://127.0.0.1:${PORT}/index.html"

# Pick whatever's available to serve the static files.
if command -v python3 >/dev/null 2>&1; then
  SERVER=(python3 -m http.server "$PORT" --bind 127.0.0.1)
elif command -v python >/dev/null 2>&1; then
  SERVER=(python -m SimpleHTTPServer "$PORT")
elif command -v npx >/dev/null 2>&1; then
  SERVER=(npx --yes serve -l "$PORT")
else
  echo "No python or npx found. Just open index.html directly in your browser."
  exit 1
fi

echo "🎲 Serving craps at ${URL}"
echo "   Press Ctrl+C to stop."

# Try to open a browser (best-effort; ignore failures on headless boxes).
( sleep 1
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  elif command -v start >/dev/null 2>&1; then start "$URL"
  fi ) >/dev/null 2>&1 &

exec "${SERVER[@]}"
