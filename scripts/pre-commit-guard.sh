#!/bin/bash
# Pre-commit guard: block commits whose staged changes contain personal data.
# The private-terms list itself is gitignored (add one term per line to
# .git-personal-terms). A match is a real leak until proven otherwise: fix the
# file, don't bypass with --no-verify.
TERMS_FILE="$(git rev-parse --show-toplevel)/.git-personal-terms"
[ -f "$TERMS_FILE" ] || exit 0

STAGED=$(git diff --cached --unified=0 | grep '^+' | grep -v '^+++' || true)
[ -z "$STAGED" ] && exit 0

FAIL=0
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
