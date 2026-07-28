#!/usr/bin/env python3
"""Report whether a composed clip actually sounds played rather than programmed.

    scripts/analyze-clip.py <track_index> <clip_index> [--cycle BEATS]

Reads the clip back out of Live through the app's tool endpoint and checks the
things that separate a performance from a grid: velocity spread, how far notes
sit off the grid, whether durations are being used expressively, and whether
any two cycles are identical (the giveaway of a loop).

--cycle sets the phrase length used for the per-cycle breakdown; 8 beats is one
Adi tala cycle, which is why it is the default.
"""

import json
import os
import subprocess
import sys

PORT = os.environ.get("PORT", "3017")


def fetch(track: int, clip: int) -> list[dict]:
    payload = json.dumps(
        {"name": "get_live_clip_notes", "args": {"track_index": track, "clip_index": clip}}
    )
    raw = subprocess.run(
        ["curl", "-sS", "-m", "30", "-X", "POST",
         f"http://localhost:{PORT}/api/talk/tools",
         "-H", "Content-Type: application/json", "-d", payload],
        capture_output=True, text=True, check=True,
    ).stdout
    body = json.loads(raw)
    if "error" in body:
        sys.exit(f"tool error: {body['error']}")
    return body["result"]["notes"]


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    track, clip = int(sys.argv[1]), int(sys.argv[2])
    cycle = 8.0
    if "--cycle" in sys.argv:
        cycle = float(sys.argv[sys.argv.index("--cycle") + 1])

    notes = fetch(track, clip)
    if not notes:
        sys.exit("clip is empty")
    notes.sort(key=lambda n: n["startBeats"])

    vels = [n["velocity"] for n in notes]
    durs = [round(n["durationBeats"], 2) for n in notes]
    # Distance from the nearest 16th, in beats. Zero everywhere means quantised.
    offs = [abs(n["startBeats"] * 4 - round(n["startBeats"] * 4)) / 4 for n in notes]
    span = max(n["startBeats"] + n["durationBeats"] for n in notes)

    print(f"{len(notes)} notes over {span:.2f} beats")
    print(f"velocity   {min(vels)}-{max(vels)}, {len(set(vels))} distinct")
    print(f"duration   {min(durs):.2f}-{max(durs):.2f}, {len(set(durs))} distinct")
    print(f"on grid    {sum(1 for o in offs if o < 0.001)}/{len(notes)} exactly, "
          f"max drift {max(offs):.3f} beats")
    print(f"pitches    {sorted({n['note'] for n in notes})}")

    count = int(span // cycle) + (1 if span % cycle else 0)
    per = [sum(1 for n in notes if c * cycle <= n["startBeats"] < (c + 1) * cycle)
           for c in range(count)]
    print(f"\nnotes per {cycle:g}-beat cycle: {per}")

    # Quantise to a 16th before comparing, so cycles that differ only by human
    # timing still register as repeats. Identical pairs mean it is looping.
    def shape(c: int) -> tuple:
        return tuple(
            (round((n["startBeats"] - c * cycle) * 4), n["pitch"])
            for n in notes if c * cycle <= n["startBeats"] < (c + 1) * cycle
        )

    shapes = [shape(c) for c in range(count)]
    dupes = [(i + 1, j + 1) for i in range(count) for j in range(i + 1, count)
             if shapes[i] and shapes[i] == shapes[j]]
    print(f"identical cycle pairs: {dupes or 'none'}")

    held = [n for n in notes if n["durationBeats"] > 0.8]
    if held:
        print(f"\nlong holds ({len(held)}) — the choke/release gestures:")
        for n in held:
            print(f"  beat {n['startBeats']:7.2f}  {n['note']:<4} "
                  f"dur {n['durationBeats']:.2f}  vel {n['velocity']}")


if __name__ == "__main__":
    main()
