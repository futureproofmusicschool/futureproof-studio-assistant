export type MidiTheoryNote = {
  pitch: number;
  /** Beats from the start. The analyzer reads this name, not `start`. */
  startTime: number;
  duration: number;
  velocity?: number;
  mute?: boolean;
};

export type MidiTheoryResult = {
  chords: { beat?: number; chord?: string; chord_full?: string; root?: string; notes?: string[] }[];
  progression: { chord?: string; chord_full?: string; roman?: string; beat?: number }[];
  key_analysis: { tonic?: string; mode?: string; confidence?: number };
  harmonic_rhythm: Record<string, unknown>;
  pitch_distribution: { note?: string; count?: number; percentage?: number }[];
  summary: string;
  note_count: number;
};

/** Vendored from kadence-integrated (apps/server/src/lib/midi-theory.js). Zero-dependency. */
export declare function analyzeMidiTheory(notes: MidiTheoryNote[]): MidiTheoryResult;
