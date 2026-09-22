#!/bin/bash
# Double-click to run the studio assistant. Opens the app in your browser,
# starting the local server first if it isn't already running.
set -euo pipefail
cd "$(dirname "$0")"

PORT=3017
ORIGIN="http://127.0.0.1:$PORT"
URL="$ORIGIN/talk"
HEALTH_URL="$ORIGIN/api/health"

assistant_is_running() {
  local marker
  marker="$(curl -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null)" || return 1
  [ "$marker" = '{"app":"futureproof-studio-assistant","protocol":1}' ]
}

port_is_answering() {
  # A slow HTTP response still means the port is occupied. Test the TCP
  # listener directly so waking a sleeping server never starts a rival one.
  nc -z -w 1 127.0.0.1 "$PORT" 2>/dev/null
}

# Already running (the desktop app or another terminal)? Just open it.
if assistant_is_running; then
  open "$URL"
  echo "The assistant is already running. Opened $URL"
  exit 0
fi

if port_is_answering; then
  echo "Port $PORT is already in use by another local service. Studio Assistant was not opened."
  read -r -p "Press Enter to close."
  exit 1
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

# Build before starting if source or dependencies have changed.
if ! node --input-type=module -e 'import {resolveProductionBuild} from "./desktop/production-build.mjs"; resolveProductionBuild("app");' 2>/dev/null; then
  npm run build --prefix app
fi

echo "Starting the studio assistant on port $PORT..."
echo "Keep this window open while you use it; close it (Ctrl+C) to stop."

# Open the browser once the server answers.
(
  for _ in $(seq 1 60); do
    if assistant_is_running; then
      open "$URL"
      exit 0
    fi
    sleep 1
  done
) &

exec npm start --prefix app
