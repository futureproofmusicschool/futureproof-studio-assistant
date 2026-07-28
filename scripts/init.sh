#!/bin/bash
# First-run setup: initialize or reconnect the external student-data directory
# and install the personal-data pre-commit guard. Safe to re-run any time.
set -euo pipefail
cd "$(dirname "$0")/.."

node scripts/init-data.mjs

if [ -d .git ]; then
  cp scripts/pre-commit-guard.sh .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  echo "installed pre-commit personal-data guard"
fi

echo "done. Start the app with: npm install --prefix app && npm run dev --prefix app"
