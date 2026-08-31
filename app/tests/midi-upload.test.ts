import assert from "node:assert/strict";
import test from "node:test";
import { describeMidi } from "../lib/midi/upload-analysis.js";

/** One beat of C major at 120 BPM in 4/4. */
function cMajorMidi() {
  return Uint8Array.from([
    // Header: format 0, one track, 480 ticks per beat.
    0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06,
    0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
    // Track header: 44 bytes.
    0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x2c,
    // 120 BPM and 4/4.
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
    // C3, E3, G3 note-ons.
    0x00, 0x90, 0x3c, 0x64,
    0x00, 0x90, 0x40, 0x64,
    0x00, 0x90, 0x43, 0x64,
    // Release the chord after 480 ticks (one beat).
    0x83, 0x60, 0x80, 0x3c, 0x00,
    0x00, 0x80, 0x40, 0x00,
    0x00, 0x80, 0x43, 0x00,
    0x00, 0xff, 0x2f, 0x00,
  ]);
}

test("uploaded MIDI becomes useful musical-analysis context", () => {
  const summary = describeMidi(cMajorMidi());

  assert.match(summary, /3 notes across 1 track, 1 beats long\./);
  assert.match(summary, /Tempo: 120 BPM\./);
  assert.match(summary, /Time signature: 4\/4\./);
  assert.match(summary, /Pitch range: MIDI 60 to 67\./);
  assert.match(summary, /C major/i);
  assert.match(summary, /Roman numerals: I/);
  assert.match(summary, /Chords by beat: 0 C/);
});

test("invalid uploads fail as MIDI instead of producing invented analysis", () => {
  assert.throws(() => describeMidi(Uint8Array.from([0x00, 0x01, 0x02])), /MIDI file ended unexpectedly/);
});
