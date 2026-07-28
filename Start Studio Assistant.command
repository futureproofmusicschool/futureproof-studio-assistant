#!/bin/bash
# Double-click to run the studio assistant. Opens the app in your browser,
# starting the local server first if it isn't already running.
set -euo pipefail
cd "$(dirname "$0")"

PORT=3017
URL="http://localhost:$PORT/talk"

# Already running (the desktop app or another terminal)? Just open it.
if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT"; then
  open "$URL"
  echo "The assistant is already running. Opened $URL"
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it from https://nodejs.org and run this again."
  read -r -p "Press Enter to close."
  exit 1
fi

if [ ! -d app/node_modules ]; then
  echo "First run: installing dependencies (a few minutes)..."
  npm install --prefix app
fi

echo "Starting the studio assistant on port $PORT..."
echo "Keep this window open while you use it; close it (Ctrl+C) to stop."

# Open the browser once the server answers.
(
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null --max-time 1 "http://localhost:$PORT"; then
      open "$URL"
      exit 0
    fi
    sleep 1
  done
) &

exec npm run dev --prefix app
