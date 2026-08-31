import { analyzeMidiTheory } from "./midi-theory";
import { parseMidiFile } from "./smf";

/** Turn an uploaded Standard MIDI File into durable conversation context. */
export function describeMidi(bytes: Uint8Array) {
  const parsed = parseMidiFile(bytes);
  // The analyzer came from a codebase where notes arrive from Ableton, so it
  // reads startTime rather than start.
  const theory = analyzeMidiTheory(
    parsed.notes.map((note) => ({ ...note, startTime: note.start, mute: false })),
  );

  const pitches = parsed.notes.map((note) => note.pitch);
  const lines = [
    `${parsed.notes.length} notes across ${parsed.trackCount} track${parsed.trackCount === 1 ? "" : "s"}, ${parsed.lengthBeats} beats long.`,
    parsed.bpm ? `Tempo: ${parsed.bpm} BPM.` : null,
    parsed.timeSignature ? `Time signature: ${parsed.timeSignature}.` : null,
    `Pitch range: MIDI ${Math.min(...pitches)} to ${Math.max(...pitches)}.`,
    theory.summary ? `\n${theory.summary}` : null,
    theory.progression?.length
      ? `Roman numerals: ${theory.progression.map((step) => step.roman ?? "?").join(" - ")}`
      : null,
    theory.chords?.length
      ? `Chords by beat: ${theory.chords
          .slice(0, 12)
          .map((chord) => `${chord.beat} ${chord.chord ?? "?"}`)
          .join(", ")}`
      : null,
  ].filter(Boolean);

  return lines.join("\n").slice(0, 4000);
}
