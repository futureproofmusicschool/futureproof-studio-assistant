#!/bin/bash
# First-run setup: copy example starter files into their real (gitignored)
# locations, without overwriting anything that already exists, and install the
# personal-data pre-commit guard. Safe to re-run any time.
set -euo pipefail
cd "$(dirname "$0")/.."

copy_if_missing() {
  if [ ! -e "$2" ]; then
    mkdir -p "$(dirname "$2")"
    cp "$1" "$2"
    echo "created $2"
  fi
}

copy_if_missing examples/assistant.json assistant.json
copy_if_missing examples/board.json board/board.json
copy_if_missing examples/contacts.json contacts/contacts.json
copy_if_missing examples/prompt.md voice/prompt.md
copy_if_missing examples/studio-context.md .claude/rules/studio-context.md
copy_if_missing examples/CLAUDE.local.md CLAUDE.local.md
copy_if_missing examples/memory/working-self.md memory/working-self.md
copy_if_missing examples/memory/episodic/2026-07-17-example-session-log.md memory/episodic/2026-07-17-example-session-log.md
copy_if_missing examples/memory/semantic/example-taste-note.md memory/semantic/example-taste-note.md
copy_if_missing examples/memory/procedural/example-export-checklist.md memory/procedural/example-export-checklist.md
mkdir -p plans voice/transcripts outbox

if [ ! -f .env ]; then
  printf 'GEMINI_API_KEY=\n' > .env
  echo "created .env (add your GEMINI_API_KEY, or enter it in the app's setup screen)"
fi

if [ -d .git ]; then
  cp scripts/pre-commit-guard.sh .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  echo "installed pre-commit personal-data guard"
fi

echo "done. Start the app with: npm install --prefix app && npm run dev --prefix app"
