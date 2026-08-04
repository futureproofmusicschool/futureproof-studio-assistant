/**
 * A Standard MIDI File reader, just enough of one.
 *
 * The analyzer next door wants a flat note array in beats; Ableton hands that
 * over directly, but a .mid file the artist drags in has to be unpacked first.
 * Only what that needs is implemented: note on/off pairing, the division
 * header, and enough tempo reading to report BPM. Everything else (SysEx,
 * controllers, meta text) is skipped by length.
 */

export type MidiNote = {
  /** MIDI note number, 0-127. */
  pitch: number;
  /** Start position in beats from the top of the file. */
  start: number;
  /** Length in beats. */
  duration: number;
  velocity: number;
  mute?: boolean;
};

export type ParsedMidi = {
  notes: MidiNote[];
  /** Tempo from the first set-tempo event, when the file carries one. */
  bpm: number | null;
  timeSignature: string | null;
  trackCount: number;
  /** Total length in beats, rounded up to a bar-ish number by the caller. */
  lengthBeats: number;
};

class Reader {
  offset = 0;
  constructor(private readonly view: Uint8Array) {}

  get done() {
    return this.offset >= this.view.length;
  }

  byte() {
    if (this.offset >= this.view.length) throw new Error("MIDI file ended unexpectedly.");
    return this.view[this.offset++];
  }

  bytes(count: number) {
    if (this.offset + count > this.view.length) throw new Error("MIDI file ended unexpectedly.");
    const slice = this.view.subarray(this.offset, this.offset + count);
    this.offset += count;
    return slice;
  }

  uint16() {
    return (this.byte() << 8) | this.byte();
  }

  uint32() {
    return ((this.byte() << 24) | (this.byte() << 16) | (this.byte() << 8) | this.byte()) >>> 0;
  }

  /** Variable-length quantity: seven bits per byte, high bit means "more". */
  varint() {
    let value = 0;
    for (let guard = 0; guard < 4; guard += 1) {
      const byte = this.byte();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error("Malformed variable-length value in MIDI file.");
  }

  ascii(count: number) {
    return String.fromCharCode(...Array.from(this.bytes(count)));
  }
}

export function parseMidiFile(data: Uint8Array): ParsedMidi {
  const reader = new Reader(data);

  if (reader.ascii(4) !== "MThd") {
    throw new Error("That does not look like a MIDI file (no MThd header).");
  }
  const headerLength = reader.uint32();
  reader.uint16(); // format: 0, 1, or 2. All three flatten the same way here.
  const trackCount = reader.uint16();
  const division = reader.uint16();
  if (headerLength > 6) reader.bytes(headerLength - 6);

  if (division & 0x8000) {
    // SMPTE timing. Rare, and the analyzer works in beats, so there is nothing
    // honest to convert to.
    throw new Error("This MIDI file uses SMPTE timecode, which this reader does not handle.");
  }
  const ticksPerBeat = division || 480;

  const notes: MidiNote[] = [];
  let bpm: number | null = null;
  let timeSignature: string | null = null;
  let lengthTicks = 0;

  for (let track = 0; track < trackCount && !reader.done; track += 1) {
    let chunkType: string;
    let chunkLength: number;
    try {
      chunkType = reader.ascii(4);
      chunkLength = reader.uint32();
    } catch {
      break;
    }

    if (chunkType !== "MTrk") {
      reader.bytes(Math.min(chunkLength, data.length - reader.offset));
      continue;
    }

    const trackEnd = reader.offset + chunkLength;
    let tick = 0;
    let runningStatus = 0;
    // pitch -> stack of unfinished note-ons, so repeated notes pair correctly.
    const open = new Map<number, { tick: number; velocity: number }[]>();

    while (reader.offset < trackEnd) {
      let status: number;
      try {
        tick += reader.varint();
        const next = reader.byte();
        if (next & 0x80) {
          status = next;
          runningStatus = next;
        } else {
          // Running status: the byte we just read is the first data byte.
          status = runningStatus;
          reader.offset -= 1;
        }
      } catch {
        break;
      }

      const command = status & 0xf0;

      try {
        if (status === 0xff) {
          const type = reader.byte();
          const length = reader.varint();
          const payload = reader.bytes(length);
          if (type === 0x51 && length === 3 && bpm === null) {
            const microsPerBeat = (payload[0] << 16) | (payload[1] << 8) | payload[2];
            if (microsPerBeat > 0) bpm = Math.round((60_000_000 / microsPerBeat) * 100) / 100;
          } else if (type === 0x58 && length >= 2 && timeSignature === null) {
            timeSignature = `${payload[0]}/${2 ** payload[1]}`;
          }
        } else if (status === 0xf0 || status === 0xf7) {
          reader.bytes(reader.varint());
        } else if (command === 0x90 || command === 0x80) {
          const pitch = reader.byte();
          const velocity = reader.byte();
          // A note-on with zero velocity is a note-off; plenty of files do this.
          if (command === 0x90 && velocity > 0) {
            const stack = open.get(pitch) ?? [];
            stack.push({ tick, velocity });
            open.set(pitch, stack);
          } else {
            const stack = open.get(pitch);
            const started = stack?.shift();
            if (started) {
              notes.push({
                pitch,
                start: started.tick / ticksPerBeat,
                duration: Math.max(tick - started.tick, 1) / ticksPerBeat,
                velocity: started.velocity,
              });
              if (tick > lengthTicks) lengthTicks = tick;
            }
          }
        } else if (command === 0xc0 || command === 0xd0) {
          reader.byte();
        } else if (command >= 0x80 && command <= 0xe0) {
          reader.bytes(2);
        } else {
          // Unknown status: the stream is out of sync, so abandon this track
          // rather than emit garbage notes.
          break;
        }
      } catch {
        break;
      }
    }

    // Notes still held when the track ended: give them what length we know.
    for (const [pitch, stack] of Array.from(open.entries())) {
      for (const started of stack) {
        notes.push({
          pitch,
          start: started.tick / ticksPerBeat,
          duration: Math.max(tick - started.tick, ticksPerBeat) / ticksPerBeat,
          velocity: started.velocity,
        });
      }
    }

    reader.offset = Math.min(trackEnd, data.length);
  }

  if (notes.length === 0) throw new Error("No notes found in that MIDI file.");

  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return {
    notes,
    bpm,
    timeSignature,
    trackCount,
    lengthBeats: Math.round((lengthTicks / ticksPerBeat) * 100) / 100,
  };
}
