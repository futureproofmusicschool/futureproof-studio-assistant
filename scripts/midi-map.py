#!/usr/bin/env python3
"""Turn a MIDI file into the rhythmic map a composer brief writes against.

    scripts/midi-map.py <file.mid> [--section BEATS]

Made for Mirelo/MuScriptor transcriptions of full mixes: one track per
instrument, the whole piece in one file. The output is text meant to be pasted
into a compose_midi_part brief, so it is compact on purpose — a model needs to
know where the music is dense, where it breathes, and where things enter and
leave, not every note.

Stdlib only, no mido dependency: transcription files use a small, boring subset
of the format and this parses exactly that subset.

--section sets the summary window in beats (default 16 = 4 bars of 4/4).
"""

import struct
import sys
from collections import defaultdict

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def note_name(pitch: int) -> str:
    # Ableton's convention: middle C (60) is C3.
    return f"{NOTE_NAMES[pitch % 12]}{pitch // 12 - 2}"


def read_varlen(data: bytes, pos: int) -> tuple[int, int]:
    value = 0
    while True:
        byte = data[pos]
        pos += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, pos


def parse(path: str):
    """Returns (ticks_per_beat, tempo_us, tracks) where each track is
    {"name": str, "notes": [(start_tick, dur_ticks, pitch, velocity)]}."""
    with open(path, "rb") as f:
        data = f.read()

    if data[:4] != b"MThd":
        sys.exit(f"{path} is not a MIDI file (missing MThd).")
    ticks_per_beat = struct.unpack(">H", data[12:14])[0]
    if ticks_per_beat & 0x8000:
        sys.exit("SMPTE-timed MIDI files are not supported; re-export with beat timing.")

    pos = 8 + struct.unpack(">I", data[4:8])[0]
    tempo_us = 500_000  # MIDI default, 120 BPM
    tracks = []

    while pos + 8 <= len(data):
        if data[pos:pos + 4] != b"MTrk":
            break
        length = struct.unpack(">I", data[pos + 4:pos + 8])[0]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 8 + length

        tick = 0
        name = ""
        open_notes: dict[tuple[int, int], tuple[int, int]] = {}
        notes = []
        status = 0
        cpos = 0

        while cpos < len(chunk):
            delta, cpos = read_varlen(chunk, cpos)
            tick += delta
            byte = chunk[cpos]

            if byte == 0xFF:  # meta
                kind = chunk[cpos + 1]
                mlen, mpos = read_varlen(chunk, cpos + 2)
                if kind == 0x03 and not name:
                    name = chunk[mpos:mpos + mlen].decode("latin-1").strip()
                elif kind == 0x51:
                    tempo_us = int.from_bytes(chunk[mpos:mpos + mlen], "big")
                cpos = mpos + mlen
                continue
            if byte in (0xF0, 0xF7):  # sysex
                slen, spos = read_varlen(chunk, cpos + 1)
                cpos = spos + slen
                continue

            if byte & 0x80:
                status = byte
                cpos += 1
            kind = status & 0xF0
            channel = status & 0x0F

            if kind in (0x80, 0x90):
                pitch, velocity = chunk[cpos], chunk[cpos + 1]
                cpos += 2
                if kind == 0x90 and velocity > 0:
                    open_notes[(channel, pitch)] = (tick, velocity)
                else:
                    started = open_notes.pop((channel, pitch), None)
                    if started:
                        notes.append((started[0], tick - started[0], pitch, started[1]))
            elif kind in (0xA0, 0xB0, 0xE0):
                cpos += 2
            elif kind in (0xC0, 0xD0):
                cpos += 1
            else:
                cpos += 1  # unknown; skip a byte rather than loop forever

        # A transcription should not leave notes hanging, but close them anyway.
        for (channel, pitch), (start, velocity) in open_notes.items():
            notes.append((start, ticks_per_beat, pitch, velocity))
        if notes:
            notes.sort()
            tracks.append({"name": name or f"track {len(tracks)}", "notes": notes})

    return ticks_per_beat, tempo_us, tracks


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    section = 16.0
    if "--section" in sys.argv:
        section = float(sys.argv[sys.argv.index("--section") + 1])

    tpb, tempo_us, tracks = parse(path)
    if not tracks:
        sys.exit("no notes found in any track")
    bpm = 60_000_000 / tempo_us
    end = max(n[0] + n[1] for t in tracks for n in t["notes"]) / tpb
    sections = int(end // section) + (1 if end % section else 0)

    print(f"# {path.rsplit('/', 1)[-1]} — {bpm:.1f} BPM, {end:.1f} beats, "
          f"{len(tracks)} tracks, section = {section:g} beats\n")

    for t in tracks:
        beats = [n[0] / tpb for n in t["notes"]]
        pitches = [n[2] for n in t["notes"]]
        print(f"## {t['name']} — {len(beats)} notes, "
              f"range {note_name(min(pitches))}..{note_name(max(pitches))}, "
              f"plays {min(beats):.1f} to {max(beats):.1f}")

        # Density per section, as a sparkline the composer can read at a glance.
        counts = defaultdict(int)
        for b in beats:
            counts[int(b // section)] += 1
        peak = max(counts.values())
        line = []
        for s in range(sections):
            c = counts.get(s, 0)
            line.append("." if c == 0 else str(min(9, round(9 * c / peak))))
        print(f"   density 0-9 per section: {''.join(line)}")

        # Passages: a silence of 4+ beats ends one. What the composer needs is
        # "plays 0-39, rests, returns sparse at 64", not every note boundary.
        passages = []
        start = prev = beats[0]
        count = 1
        for b in beats[1:]:
            if b - prev > 4:
                passages.append((start, prev, count))
                start, count = b, 0
            prev = b
            count += 1
        passages.append((start, prev, count))
        def label(s: float, e: float, c: int) -> str:
            if e - s < 2:
                return f"stab at {s:.0f}"
            feel = "dense" if c / (e - s) > 1 else "sparse"
            return f"{s:.0f}-{e:.0f} ({c} notes, {feel})"

        spans = [label(s, e, c) for s, e, c in passages]
        print(f"   passages: {'; '.join(spans[:12])}{' …' if len(spans) > 12 else ''}\n")


if __name__ == "__main__":
    main()
