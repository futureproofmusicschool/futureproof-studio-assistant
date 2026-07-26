#!/bin/bash
# Install the vendored AbletonOSC Remote Script into Ableton Live's User Library.
#
# Usage:
#   scripts/install-abletonosc.sh              # install on this Mac
#   scripts/install-abletonosc.sh user@host    # install on a remote Mac over ssh/scp
#
# After installing: open Live on that machine, Preferences -> Link, Tempo & MIDI,
# set a Control Surface slot to "AbletonOSC". Live's status bar should show
# "AbletonOSC: Listening for OSC on port 11000". Restart Live after any update.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/ableton/AbletonOSC"
DEST_REL="Music/Ableton/User Library/Remote Scripts"

if [ ! -d "$SRC" ]; then
  echo "error: $SRC not found" >&2
  exit 1
fi

if [ $# -eq 0 ]; then
  DEST="$HOME/$DEST_REL/AbletonOSC"
  echo "Installing AbletonOSC locally to: $DEST"
  mkdir -p "$(dirname "$DEST")"
  rm -rf "$DEST"
  rsync -a --exclude "__pycache__" --exclude "*.pyc" --exclude "tests" "$SRC/" "$DEST/"
  echo "Done. In Live: Preferences -> Link, Tempo & MIDI -> Control Surface -> AbletonOSC."
else
  REMOTE="$1"
  echo "Installing AbletonOSC on $REMOTE (needs Remote Login enabled there)..."
  ssh "$REMOTE" "mkdir -p \"\$HOME/$DEST_REL\" && rm -rf \"\$HOME/$DEST_REL/AbletonOSC\""
  rsync -a --exclude "__pycache__" --exclude "*.pyc" --exclude "tests" "$SRC/" "$REMOTE:$DEST_REL/AbletonOSC/"
  echo "Done. On $REMOTE, in Live: Preferences -> Link, Tempo & MIDI -> Control Surface -> AbletonOSC."
fi
