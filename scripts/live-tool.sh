#!/usr/bin/env bash
# Call one of the app's studio tools from the command line.
#
# The Talk tab reaches Ableton over OSC through the running app server; a CLI
# session has no other route to it (an MCP server, if installed, points at
# whichever machine it runs on, not at `abletonHost`). This wrapper is that
# route.
#
#   scripts/live-tool.sh get_live_overview
#   scripts/live-tool.sh get_live_track '{"track_index":11}'
#   scripts/live-tool.sh compose_midi_part "$(cat brief.json)"
#
# Set PORT to override the default 3017.

set -euo pipefail

name="${1:-}"
args="${2:-{\}}"
port="${PORT:-3017}"

if [[ -z "$name" ]]; then
  echo "usage: $(basename "$0") <tool_name> ['<json args>']" >&2
  exit 64
fi

# compose_midi_part hands the brief to a frontier model and can take minutes.
timeout=60
[[ "$name" == "compose_midi_part" ]] && timeout=330

payload=$(name="$name" args="$args" python3 -c '
import json, os, sys
try:
    parsed = json.loads(os.environ["args"])
except json.JSONDecodeError as error:
    sys.exit(f"args is not valid JSON: {error}")
print(json.dumps({"name": os.environ["name"], "args": parsed}))
')

curl -sS -m "$timeout" -X POST "http://localhost:${port}/api/talk/tools" \
  -H 'Content-Type: application/json' \
  -d "$payload" | python3 -m json.tool
