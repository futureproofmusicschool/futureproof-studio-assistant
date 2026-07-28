#!/bin/bash
# Pre-commit guard: block commits whose staged changes contain personal data.
# The private-terms list itself is gitignored (add one term per line to
# .git-personal-terms). A match is a real leak until proven otherwise: fix the
# file, don't bypass with --no-verify.
TERMS_FILE="$(git rev-parse --show-toplevel)/.git-personal-terms"

# .gitignore only protects untracked files. Block the private storage paths at
# the index too, so `git add -f`, a binary file, or an accidentally tracked file
# cannot bypass the privacy boundary.
FAIL=0
while IFS= read -r path; do
  case "$path" in
    assistant.json|settings.json|ableton-hosts.json|\
    board/board.json|contacts/contacts.json|\
    memory/*|plans/*|\
    outbox/*|instruments/*|reference/*|\
    voice/prompt.md|voice/transcripts/*|\
    .claude/rules/studio-context.md|.claude/rules/*.local.md|.claude/skills/*|\
    CLAUDE.local.md|.git-personal-terms|\
    .env|.env.*|*/.env|*/.env.*)
      case "$path" in
        outbox/README.md|instruments/README.md|instruments/example-percussion.md|\
        reference/README.md|*.env.example|*.env.*.example)
          ;;
        *)
          echo "pre-commit guard: staged private path \"$path\"" >&2
          FAIL=1
          ;;
      esac
      ;;
  esac
done < <(git diff --cached --name-only --diff-filter=ACMR)

if [ "$FAIL" = 1 ]; then
  echo "Commit blocked. Personal data belongs in the gitignored files (see AGENTS.md)." >&2
  exit 1
fi

[ -f "$TERMS_FILE" ] || exit 0

STAGED=$(git diff --cached --unified=0 | grep '^+' | grep -v '^+++' || true)
[ -z "$STAGED" ] && exit 0

while IFS= read -r term; do
  [ -z "$term" ] && continue
  case "$term" in \#*) continue ;; esac
  if printf '%s\n' "$STAGED" | grep -i -q -- "$term"; then
    echo "pre-commit guard: staged changes contain the private term \"$term\"" >&2
    FAIL=1
  fi
done < "$TERMS_FILE"

if [ "$FAIL" = 1 ]; then
  echo "Commit blocked. Personal data belongs in the gitignored files (see AGENTS.md)." >&2
  exit 1
fi
