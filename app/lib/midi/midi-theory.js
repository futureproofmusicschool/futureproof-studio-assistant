'use strict';

/**
 * MIDI Theory Analysis — pure JS port of kadence-desktop-mac/midi-analysis/app.py
 *
 * Chord identification via custom lookup table, key detection via
 * Krumhansl-Schmuckler, Roman numeral mapping, harmonic rhythm analysis.
 * Zero external dependencies.
 */

// =============================================================================
// CONSTANTS
// =============================================================================

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const NOTE_TO_SEMITONE = Object.create(null);
NOTE_NAMES.forEach((n, i) => { NOTE_TO_SEMITONE[n] = i; });
// Flat equivalents
Object.assign(NOTE_TO_SEMITONE, {
  Db: 1, Eb: 3, Fb: 4, Gb: 6, Ab: 8, Bb: 10, Cb: 11,
});

/** Encode a set of intervals as a sorted comma-joined string for O(1) lookup. */
function intervalKey(intervals) {
  return [...intervals].sort((a, b) => a - b).join(',');
}

// Chord patterns: set of semitone intervals from root → [shortName, fullName]
const CHORD_PATTERNS = new Map([
  // --- Triads ---
  [[0, 4, 7],    ['', 'major']],
  [[0, 3, 7],    ['m', 'minor']],
  [[0, 3, 6],    ['dim', 'diminished']],
  [[0, 4, 8],    ['aug', 'augmented']],
  [[0, 2, 7],    ['sus2', 'suspended 2nd']],
  [[0, 5, 7],    ['sus4', 'suspended 4th']],
  // --- Seventh chords ---
  [[0, 4, 7, 11], ['maj7', 'major 7th']],
  [[0, 3, 7, 10], ['m7', 'minor 7th']],
  [[0, 4, 7, 10], ['7', 'dominant 7th']],
  [[0, 3, 6, 9],  ['dim7', 'diminished 7th']],
  [[0, 3, 6, 10], ['m7b5', 'half-diminished']],
  [[0, 3, 7, 11], ['mMaj7', 'minor-major 7th']],
  [[0, 4, 8, 10], ['aug7', 'augmented 7th']],
  // --- Sixth chords ---
  [[0, 4, 7, 9],  ['6', 'major 6th']],
  [[0, 3, 7, 9],  ['m6', 'minor 6th']],
  // --- Add chords ---
  [[0, 2, 4, 7],  ['add9', 'add 9']],
  [[0, 2, 3, 7],  ['madd9', 'minor add 9']],
  [[0, 4, 5, 7],  ['add11', 'add 11']],
  [[0, 3, 5, 7],  ['madd11', 'minor add 11']],
  // --- Extended chords (common voicings) ---
  [[0, 2, 4, 7, 10], ['9', 'dominant 9th']],
  [[0, 2, 4, 7, 11], ['maj9', 'major 9th']],
  [[0, 2, 3, 7, 10], ['m9', 'minor 9th']],
  // --- Power chord ---
  [[0, 7],        ['5', 'power chord']],
  // --- Sus variants ---
  [[0, 2, 5, 7],  ['sus2/4', 'suspended 2nd and 4th']],
  [[0, 5, 7, 10], ['7sus4', 'dominant 7th suspended 4th']],
  [[0, 2, 7, 10], ['7sus2', 'dominant 7th suspended 2nd']],
].map(([intervals, value]) => [intervalKey(intervals), value]));

// Krumhansl-Kessler key profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Pre-built MIDI → note name table
const MIDI_TO_NOTE = {};
for (let m = 0; m < 128; m++) {
  MIDI_TO_NOTE[m] = `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
}

// Scale degree mapping (semitone offset from tonic → scale degree index 1-7)
// For major: 0=1, 2=2, 4=3, 5=4, 7=5, 9=6, 11=7
const MAJOR_DEGREE_MAP = { 0: 1, 2: 2, 4: 3, 5: 4, 7: 5, 9: 6, 11: 7 };
// For minor (natural): 0=1, 2=2, 3=3, 5=4, 7=5, 8=6, 10=7
const MINOR_DEGREE_MAP = { 0: 1, 2: 2, 3: 3, 5: 4, 7: 5, 8: 6, 10: 7 };

const ROMAN_NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

// =============================================================================
// UTILITIES
// =============================================================================

function midiToNoteName(midi) {
  return MIDI_TO_NOTE[midi] || `?${midi}`;
}

function midiToPitchClass(midi) {
  return NOTE_NAMES[midi % 12];
}

function formatNoteForSpeech(name) {
  return name.replace(/#/g, ' sharp').replace(/b/g, ' flat');
}

function noteToSemitone(name) {
  const clean = name.replace(/\d+/g, '');
  return NOTE_TO_SEMITONE[clean] ?? null;
}

function getIntervalsFromRoot(rootSemitone, pitchSemitones) {
  const intervals = new Set();
  for (const p of pitchSemitones) {
    intervals.add(((p - rootSemitone) % 12 + 12) % 12);
  }
  return intervals;
}

// =============================================================================
// CHORD IDENTIFICATION
// =============================================================================

function identifyChordCustom(pitchClasses) {
  if (!pitchClasses || pitchClasses.length < 2) return null;

  const semitones = [];
  for (const pc of pitchClasses) {
    const st = noteToSemitone(pc);
    if (st !== null) semitones.push(st);
  }
  if (semitones.length < 2) return null;

  const unique = [...new Set(semitones)];

  // Try each pitch as potential root (handles inversions)
  for (const rootSt of unique) {
    const intervals = getIntervalsFromRoot(rootSt, unique);
    const key = intervalKey(intervals);
    const match = CHORD_PATTERNS.get(key);
    if (match) {
      const [shortQuality, fullQuality] = match;
      const rootName = NOTE_NAMES[rootSt];
      return {
        chord: `${rootName}${shortQuality}`,
        chord_full: `${formatNoteForSpeech(rootName)} ${fullQuality}`.trim(),
        root: rootName,
        confidence: 1.0,
      };
    }
  }
  return null;
}

function identifyChord(pitchClasses) {
  return identifyChordCustom(pitchClasses) || null;
}

// =============================================================================
// BEAT GROUPING & CHORD ANALYSIS
// =============================================================================

function groupNotesByBeat(notes, quantizeTo = 0.5) {
  const groups = new Map();

  for (const n of notes) {
    if (n.mute) continue;
    const midi = n.pitch;
    if (midi == null) continue;

    let start = Number(n.startTime ?? n.start_time ?? 0);
    const quantized = Math.round(start / quantizeTo) * quantizeTo;

    const entry = groups.get(quantized) || [];
    entry.push({
      pitch_class: midiToPitchClass(midi),
      note_name: midiToNoteName(midi),
      midi,
    });
    groups.set(quantized, entry);
  }
  return groups;
}

function getBeatStrength(beat, beatsPerBar = 4) {
  const pos = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
  if (pos === 0) return 1.0;
  if (pos === 2) return 0.75;
  if (pos === 1 || pos === 3) return 0.5;
  return 0.25;
}

function analyzeChords(notes, quantizeTo = 0.5, beatsPerBar = 4) {
  const beatGroups = groupNotesByBeat(notes, quantizeTo);
  const chords = [];
  let lastChord = null;

  const sortedBeats = [...beatGroups.keys()].sort((a, b) => a - b);

  for (const beat of sortedBeats) {
    const notesAtBeat = beatGroups.get(beat);
    const pitchClasses = [...new Set(notesAtBeat.map(n => n.pitch_class))];
    const noteNames = [...new Set(notesAtBeat.map(n => n.note_name))].sort();

    if (pitchClasses.length < 2) continue;

    const chord = identifyChord(pitchClasses);
    if (!chord) continue;

    // Skip consecutive duplicates
    if (chord.chord === lastChord) continue;
    lastChord = chord.chord;

    chords.push({
      beat,
      chord: chord.chord,
      chord_full: chord.chord_full,
      root: chord.root,
      notes: noteNames,
      pitch_classes: [...pitchClasses].sort(),
      beat_strength: getBeatStrength(beat, beatsPerBar),
    });
  }

  return chords;
}

// =============================================================================
// KEY DETECTION — Krumhansl-Schmuckler
// =============================================================================

function pearsonCorrelation(a, b) {
  const n = a.length;
  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i]; sumB += b[i];
    sumAB += a[i] * b[i];
    sumA2 += a[i] * a[i];
    sumB2 += b[i] * b[i];
  }
  const num = n * sumAB - sumA * sumB;
  const den = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
  return den === 0 ? 0 : num / den;
}

function rotateProfile(profile, offset) {
  const out = new Array(12);
  for (let i = 0; i < 12; i++) {
    out[i] = profile[((i - offset) % 12 + 12) % 12];
  }
  return out;
}

function analyzeKey(notes) {
  // Build duration-weighted pitch class histogram
  const histogram = new Float64Array(12);
  let total = 0;

  for (const n of notes) {
    if (n.mute) continue;
    const midi = n.pitch;
    if (midi == null) continue;
    const dur = Number(n.duration ?? 1);
    histogram[midi % 12] += dur;
    total += dur;
  }

  if (total === 0) return null;

  let bestKey = null;
  let bestCorr = -Infinity;

  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [profile, mode] of [[MAJOR_PROFILE, 'major'], [MINOR_PROFILE, 'minor']]) {
      const rotated = rotateProfile(profile, tonic);
      const corr = pearsonCorrelation([...histogram], rotated);
      if (corr > bestCorr) {
        bestCorr = corr;
        bestKey = { tonic: NOTE_NAMES[tonic], mode };
      }
    }
  }

  if (!bestKey) return null;

  return {
    key: `${bestKey.tonic} ${bestKey.mode}`,
    tonic: bestKey.tonic,
    mode: bestKey.mode,
    confidence: Math.round(bestCorr * 1000) / 1000,
  };
}

// =============================================================================
// HARMONIC RHYTHM
// =============================================================================

function analyzeHarmonicRhythm(chordsData, beatsPerBar = 4) {
  if (!chordsData || chordsData.length === 0) {
    return { primary_chords: [], harmonic_rhythm: 'unknown', changes_per_bar: 0 };
  }

  const strongBeatChords = chordsData.filter(c => (c.beat_strength ?? 0) >= 0.5);
  const primary = strongBeatChords.length > 0 ? strongBeatChords : chordsData;

  if (chordsData.length < 2) {
    return { primary_chords: primary, harmonic_rhythm: 'static', changes_per_bar: 0 };
  }

  const diffs = [];
  for (let i = 1; i < chordsData.length; i++) {
    const d = chordsData[i].beat - chordsData[i - 1].beat;
    if (d > 0) diffs.push(d);
  }

  if (diffs.length === 0) {
    return { primary_chords: primary, harmonic_rhythm: 'static', changes_per_bar: 0 };
  }

  const avg = diffs.reduce((s, v) => s + v, 0) / diffs.length;
  const changesPerBar = avg > 0 ? beatsPerBar / avg : 0;

  let desc;
  if (avg >= beatsPerBar * 2) desc = 'slow (chord changes every 2+ bars)';
  else if (avg >= beatsPerBar) desc = 'moderate (chord changes every bar)';
  else if (avg >= beatsPerBar / 2) desc = 'active (chord changes every half bar)';
  else desc = 'fast (chord changes more than twice per bar)';

  return {
    primary_chords: primary,
    harmonic_rhythm: desc,
    changes_per_bar: Math.round(changesPerBar * 10) / 10,
  };
}

// =============================================================================
// ROMAN NUMERALS
// =============================================================================

function extractQuality(chordSymbol, root) {
  // Strip the root (e.g. "Am" → "m", "C#dim" → "dim", "G7" → "7", "C" → "")
  if (chordSymbol.startsWith(root)) return chordSymbol.slice(root.length);
  return chordSymbol;
}

function getRomanNumeral(chordRoot, chordSymbol, keyTonic, keyMode) {
  const rootSt = NOTE_TO_SEMITONE[chordRoot];
  const tonicSt = NOTE_TO_SEMITONE[keyTonic];
  if (rootSt == null || tonicSt == null) return null;

  const quality = extractQuality(chordSymbol, chordRoot);

  const interval = ((rootSt - tonicSt) % 12 + 12) % 12;
  const degreeMap = keyMode === 'minor' ? MINOR_DEGREE_MAP : MAJOR_DEGREE_MAP;

  // Find closest scale degree
  let degree = degreeMap[interval];
  if (!degree) {
    // Try chromatic neighbors (for borrowed chords, secondary dominants, etc.)
    for (const offset of [1, -1, 2, -2]) {
      const neighbor = ((interval + offset) % 12 + 12) % 12;
      if (degreeMap[neighbor]) {
        degree = degreeMap[neighbor];
        break;
      }
    }
  }
  if (!degree) return null;

  let numeral = ROMAN_NUMERALS[degree];

  // Determine case from chord quality
  const q = quality.toLowerCase();
  const isMinorish = q.startsWith('m') || q.includes('dim');
  if (isMinorish) {
    numeral = numeral.toLowerCase();
  }

  // Add quality suffixes
  if (q.includes('dim')) numeral += '\u00B0';        // °
  else if (q.includes('aug')) numeral += '+';
  else if (q.includes('7') || q.includes('maj7')) {
    if (q.includes('maj7')) numeral += 'maj7';
    else if (q.includes('m7b5')) numeral += '\u00F8' + '7'; // ø7
    else numeral += '7';
  }

  return numeral;
}

function buildProgressionSummary(chordsData, keyInfo) {
  if (!chordsData || !keyInfo || !keyInfo.tonic) return null;

  const parts = [];
  for (const chord of chordsData.slice(0, 8)) {
    const roman = getRomanNumeral(chord.root, chord.chord, keyInfo.tonic, keyInfo.mode);
    parts.push({
      chord: chord.chord,
      chord_full: chord.chord_full,
      roman: roman || '?',
      beat: chord.beat,
    });
  }
  return parts;
}

// =============================================================================
// PITCH DISTRIBUTION
// =============================================================================

function getPitchDistribution(notes) {
  const counts = Object.create(null);
  for (const n of notes) {
    if (n.mute) continue;
    if (n.pitch == null) continue;
    const pc = midiToPitchClass(n.pitch);
    counts[pc] = (counts[pc] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([pitch, count]) => ({ pitch, count }));
}

// =============================================================================
// SUMMARY
// =============================================================================

function buildSummary(keyInfo, harmonicRhythm, progression, chordsData) {
  const parts = [];

  if (keyInfo && keyInfo.key) {
    const tonic = formatNoteForSpeech(keyInfo.tonic || '');
    const mode = keyInfo.mode || '';
    if (keyInfo.confidence != null && keyInfo.confidence >= 0.7) {
      parts.push(`This clip is in ${tonic} ${mode}`);
    } else {
      parts.push(`This clip appears to be in ${tonic} ${mode} (but the key detection confidence is low)`);
    }
  }

  if (harmonicRhythm && harmonicRhythm.harmonic_rhythm !== 'unknown') {
    parts.push(`The harmonic rhythm is ${harmonicRhythm.harmonic_rhythm}`);
  }

  if (progression && progression.length > 0) {
    const descs = progression.slice(0, 6).map(p => {
      if (p.roman && p.roman !== '?') return `${p.chord_full} (${p.roman})`;
      return p.chord_full;
    });
    parts.push(`The chord progression is: ${descs.join(', ')}`);
  } else if (chordsData && chordsData.length > 0) {
    const names = chordsData.slice(0, 6).map(c => c.chord_full);
    parts.push(`The chords are: ${names.join(', ')}`);
  } else {
    parts.push('No clear chord voicings were detected in this clip');
  }

  return parts.join('. ') + '.';
}

// =============================================================================
// MAIN EXPORT
// =============================================================================

function analyzeMidiTheory(notes) {
  const activeNotes = notes.filter(n => !n.mute);

  const chordsData = analyzeChords(notes);
  const keyInfo = analyzeKey(notes);
  const harmonicRhythm = analyzeHarmonicRhythm(chordsData);
  const progression = buildProgressionSummary(chordsData, keyInfo);
  const pitchDist = getPitchDistribution(notes);
  const summary = buildSummary(keyInfo, harmonicRhythm, progression, chordsData);

  return {
    chords: chordsData.slice(0, 16),
    progression: progression ? progression.slice(0, 8) : [],
    key_analysis: keyInfo,
    harmonic_rhythm: harmonicRhythm,
    pitch_distribution: pitchDist.slice(0, 7),
    summary,
    note_count: activeNotes.length,
  };
}

module.exports = { analyzeMidiTheory };
