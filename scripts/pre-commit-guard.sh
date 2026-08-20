#!/bin/bash
# Pre-commit guard: block commits whose staged changes contain personal data.
# The private-terms list itself is gitignored (add one term per line to
# .git-personal-terms). A match is a real leak until proven otherwise: fix the
# file, don't bypass with --no-verify.
# This is intentionally only a seatbelt. A passing pattern scan never overrides
# the zero-personal-information rule in AGENTS.md or makes unrecognized data safe.
TERMS_FILE="$(git rev-parse --show-toplevel)/.git-personal-terms"

# .gitignore only protects untracked files. Block the private storage paths at
# the index too, so `git add -f`, a binary file, or an accidentally tracked file
# cannot bypass the privacy boundary.
FAIL=0
while IFS= read -r path; do
  case "$path" in
    assistant.json|settings.json|ableton-hosts.json|\
    board/board.json|contacts/contacts.json|\
    documents|documents/*|google|google/*|\
    memory|memory/*|plans|plans/*|\
    outbox/*|instruments/*|reference/*|\
    voice/prompt.md|voice/transcripts|voice/transcripts/*|\
    .claude/rules/studio-context.md|.claude/rules/*.local.md|.claude/skills|.claude/skills/*|\
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

STAGED=$(git diff --cached --unified=0 | grep '^+' | grep -v '^+++' || true)
[ -z "$STAGED" ] && exit 0

# These credentials should never appear in tracked text even when a private
# path was copied under an innocent filename. Only inspect added lines and do
# not print the matching value back to the terminal.
if printf '%s\n' "$STAGED" | grep -E -q -- \
  'AIza[0-9A-Za-z_-]{30,}|GOCSPX-[0-9A-Za-z_-]{16,}|ya29\.[0-9A-Za-z._-]{20,}|1//[0-9A-Za-z._-]{20,}|sk-ant-[0-9A-Za-z_-]{20,}|sk-(proj|svcacct)-[0-9A-Za-z_-]{20,}|gh[pousr]_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|AKIA[0-9A-Z]{16}|sk_live_[0-9A-Za-z]{20,}|sb_secret_[0-9A-Za-z_-]{20,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'; then
  echo "pre-commit guard: staged changes look like they contain an API or OAuth credential" >&2
  echo "Commit blocked. Remove the credential and rotate it if it was real." >&2
  exit 1
fi

[ -f "$TERMS_FILE" ] || exit 0

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
