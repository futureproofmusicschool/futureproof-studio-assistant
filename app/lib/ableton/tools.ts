import { ensureLive, oscQuery, oscSend, currentAbletonHost } from "@/lib/ableton/bridge";
import { composePart, type ComposedNote } from "@/lib/composer";

/**
 * Ableton Live tools for the Talk voice agent, speaking to the vendored
 * AbletonOSC fork through the OSC bridge. Read tools answer "what am I looking
 * at"; control tools make the agent a collaborator (transport, mixer, clips,
 * MIDI notes, arrangement placement). Results stay compact on purpose: every
 * byte returned is latency in a live voice conversation.
 *
 * Reply shape reminders (from ableton/AbletonOSC):
 * - /live/track/* replies prefix (track_index, ...values)
 * - /live/clip/* and /live/clip_slot/* replies prefix (track, clip, ...values)
 * - set/* and most methods send no reply; state is read back when it matters.
 */

type ToolResult = { result: unknown } | { error: string };

const MAX_NOTES_RETURNED = 160;
const MAX_NOTES_PER_EDIT = 200;

function num(value: unknown): number {
  const n = typeof value === "boolean" ? Number(value) : Number(value as number);
  if (!Number.isFinite(n)) throw new Error(`Expected a number from Live, got ${String(value)}.`);
  return n;
}

function bool(value: unknown): boolean {
  return value === true || value === 1;
}

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function requireInt(args: Record<string, unknown>, key: string): number {
  const value = Number(args[key]);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer.`);
  return value;
}

function requireNumber(args: Record<string, unknown>, key: string): number {
  const value = Number(args[key]);
  if (!Number.isFinite(value)) throw new Error(`${key} must be a number.`);
  return value;
}

/** Ableton's convention: middle C is C3 = MIDI 60. Accepts "C3", "F#2", "Eb-1". */
export function noteNameToMidi(name: string): number {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
  if (!match) throw new Error(`"${name}" is not a note name like C3 or F#2.`);
  const base: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  let pitchClass = base[match[1].toLowerCase()];
  if (match[2] === "#") pitchClass += 1;
  if (match[2] === "b") pitchClass -= 1;
  const midi = (Number(match[3]) + 2) * 12 + pitchClass;
  if (midi < 0 || midi > 127) throw new Error(`"${name}" is outside the MIDI range.`);
  return midi;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiToNoteName(pitch: number): string {
  return `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 2}`;
}

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

async function getLiveOverview(): Promise<unknown> {
  const version = await ensureLive();
  const [tempo] = await oscQuery("/live/song/get/tempo");
  const [sigNum] = await oscQuery("/live/song/get/signature_numerator");
  const [sigDen] = await oscQuery("/live/song/get/signature_denominator");
  const [playing] = await oscQuery("/live/song/get/is_playing");
  const [numTracks] = await oscQuery("/live/song/get/num_tracks");
  const names = await oscQuery("/live/song/get/track_names");
  const data = await oscQuery("/live/song/get/track_data", [
    0,
    -1,
    "track.mute",
    "track.solo",
    "track.playing_slot_index",
  ]);

  const tracks = names.map((name, index) => {
    const muted = bool(data[index * 3]);
    const soloed = bool(data[index * 3 + 1]);
    const playingSlot = num(data[index * 3 + 2] ?? -1);
    return {
      index,
      name: str(name),
      ...(muted ? { muted } : {}),
      ...(soloed ? { soloed } : {}),
      ...(playingSlot >= 0 ? { playingClipIndex: playingSlot } : {}),
    };
  });

  return {
    live: version,
    host: currentAbletonHost(),
    tempo: num(tempo),
    timeSignature: `${num(sigNum)}/${num(sigDen)}`,
    playing: bool(playing),
    trackCount: num(numTracks),
    tracks,
  };
}

async function getLiveTrack(args: Record<string, unknown>): Promise<unknown> {
  await ensureLive();
  const index = requireInt(args, "track_index");
  const [, name] = await oscQuery("/live/track/get/name", [index]);
  const [, canBeArmed] = await oscQuery("/live/track/get/can_be_armed", [index]);
  const [, muted] = await oscQuery("/live/track/get/mute", [index]);
  const [, soloed] = await oscQuery("/live/track/get/solo", [index]);
  const [, volume] = await oscQuery("/live/track/get/volume", [index]);
  const [, pan] = await oscQuery("/live/track/get/panning", [index]);
  const armed = bool(canBeArmed) ? bool((await oscQuery("/live/track/get/arm", [index]))[1]) : false;

  const [, ...deviceNames] = await oscQuery("/live/track/get/devices/name", [index]);
  const [, ...deviceClasses] = await oscQuery("/live/track/get/devices/class_name", [index]);
  const [, ...clipNames] = await oscQuery("/live/track/get/clips/name", [index]);
  const [, ...clipLengths] = await oscQuery("/live/track/get/clips/length", [index]);

  const clips = clipNames
    .map((clipName, clipIndex) => ({ clipIndex, name: str(clipName), lengthBeats: clipLengths[clipIndex] }))
    .filter((clip) => clipNames[clip.clipIndex] !== null && clipNames[clip.clipIndex] !== undefined)
    .map((clip) => ({ ...clip, lengthBeats: num(clip.lengthBeats ?? 0) }));

  return {
    index,
    name: str(name),
    muted: bool(muted),
    soloed: bool(soloed),
    armed,
    volume: num(volume),
    pan: num(pan),
    devices: deviceNames.map((deviceName, deviceIndex) => ({
      deviceIndex,
      name: str(deviceName),
      class: str(deviceClasses[deviceIndex]),
    })),
    clips,
  };
}

async function getLiveClip(args: Record<string, unknown>): Promise<unknown> {
  await ensureLive();
  const track = requireInt(args, "track_index");
  const clip = requireInt(args, "clip_index");
  const [, , hasClip] = await oscQuery("/live/clip_slot/get/has_clip", [track, clip]);
  if (!bool(hasClip)) return { trackIndex: track, clipIndex: clip, empty: true };

  const read = async (prop: string) => (await oscQuery(`/live/clip/get/${prop}`, [track, clip]))[2];
  return {
    trackIndex: track,
    clipIndex: clip,
    name: str(await read("name")),
    lengthBeats: num(await read("length")),
    isMidi: bool(await read("is_midi_clip")),
    playing: bool(await read("is_playing")),
    looping: bool(await read("looping")),
    loopStart: num(await read("loop_start")),
    loopEnd: num(await read("loop_end")),
    muted: bool(await read("muted")),
  };
}

async function getLiveClipNotes(args: Record<string, unknown>): Promise<unknown> {
  await ensureLive();
  const track = requireInt(args, "track_index");
  const clip = requireInt(args, "clip_index");
  const [, , hasClip] = await oscQuery("/live/clip_slot/get/has_clip", [track, clip]);
  if (!bool(hasClip)) throw new Error(`Track ${track} clip slot ${clip} is empty.`);
  const [, , isMidi] = await oscQuery("/live/clip/get/is_midi_clip", [track, clip]);
  if (!bool(isMidi)) throw new Error(`Track ${track} clip ${clip} is an audio clip; it has no MIDI notes.`);

  const [, , ...flat] = await oscQuery("/live/clip/get/notes", [track, clip], { timeoutMs: 3000 });
  const notes = [];
  for (let offset = 0; offset + 4 < flat.length; offset += 5) {
    notes.push({
      pitch: num(flat[offset]),
      note: midiToNoteName(num(flat[offset])),
      startBeats: num(flat[offset + 1]),
      durationBeats: num(flat[offset + 2]),
      velocity: num(flat[offset + 3]),
      ...(bool(flat[offset + 4]) ? { muted: true } : {}),
    });
  }
  notes.sort((a, b) => a.startBeats - b.startBeats || a.pitch - b.pitch);

  return {
    trackIndex: track,
    clipIndex: clip,
    noteCount: notes.length,
    notes: notes.slice(0, MAX_NOTES_RETURNED),
    ...(notes.length > MAX_NOTES_RETURNED ? { truncated: `showing first ${MAX_NOTES_RETURNED}` } : {}),
  };
}

async function getLiveArrangement(): Promise<unknown> {
  await ensureLive();
  const names = await oscQuery("/live/song/get/track_names");
  const [songLength] = await oscQuery("/live/song/get/song_length");
  const tracks = [];

  for (let index = 0; index < names.length; index += 1) {
    const [, ...clipNames] = await oscQuery("/live/track/get/arrangement_clips/name", [index]);
    const [, ...lengths] = await oscQuery("/live/track/get/arrangement_clips/length", [index]);
    const [, ...starts] = await oscQuery("/live/track/get/arrangement_clips/start_time", [index]);
    if (clipNames.length === 0) continue;

    tracks.push({
      index,
      name: str(names[index]),
      clips: clipNames
        .map((clipName, i) => ({
          name: str(clipName),
          startBeats: num(starts[i] ?? 0),
          lengthBeats: num(lengths[i] ?? 0),
        }))
        .sort((a, b) => a.startBeats - b.startBeats),
    });
  }

  return { songLengthBeats: num(songLength), tracks };
}

async function getLiveDeviceParameters(args: Record<string, unknown>): Promise<unknown> {
  await ensureLive();
  const track = requireInt(args, "track_index");
  const device = requireInt(args, "device_index");
  const [, , ...names] = await oscQuery("/live/device/get/parameters/name", [track, device], { timeoutMs: 3000 });
  const [, , ...values] = await oscQuery("/live/device/get/parameters/value", [track, device], { timeoutMs: 3000 });
  const [, , ...mins] = await oscQuery("/live/device/get/parameters/min", [track, device], { timeoutMs: 3000 });
  const [, , ...maxes] = await oscQuery("/live/device/get/parameters/max", [track, device], { timeoutMs: 3000 });

  return {
    trackIndex: track,
    deviceIndex: device,
    parameters: names.slice(0, 64).map((name, i) => ({
      parameterIndex: i,
      name: str(name),
      value: num(values[i] ?? 0),
      min: num(mins[i] ?? 0),
      max: num(maxes[i] ?? 1),
    })),
    ...(names.length > 64 ? { truncated: `showing first 64 of ${names.length}` } : {}),
  };
}

async function getLiveSelection(): Promise<unknown> {
  await ensureLive();
  const result: Record<string, unknown> = {};
  try {
    const [trackIndex] = await oscQuery("/live/view/get/selected_track");
    result.trackIndex = num(trackIndex);
    const [, name] = await oscQuery("/live/track/get/name", [num(trackIndex)]);
    result.trackName = str(name);
  } catch {
    result.trackIndex = null;
  }
  try {
    const [sceneIndex] = await oscQuery("/live/view/get/selected_scene");
    result.sceneIndex = num(sceneIndex);
  } catch {
    result.sceneIndex = null;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Control tools
// ---------------------------------------------------------------------------

async function liveTransport(args: Record<string, unknown>): Promise<unknown> {
  await ensureLive();
  const action = str(args.action);

  switch (action) {
    case "play":
      await oscSend("/live/song/start_playing");
      break;
    case "play_arrangement":
      // Session clips override the timeline until Back to Arrangement is
      // pressed; clearing it first makes "play the arrangement" mean what
      // it says.
      await oscSend("/live/song/set/back_to_arranger", [0]);
      await oscSend("/live/song/start_playing");
      break;
    case "continue":
      await oscSend("/live/song/continue_playing");
      break;
    case "stop":
      await oscSend("/live/song/stop_playing");
      break;
    case "stop_all_clips":
      await oscSend("/live/song/stop_all_clips");
      break;
    case "jump_to": {
      const beats = requireNumber(args, "value");
      await oscSend("/live/song/set/current_song_time", [beats]);
      break;
    }
    case "set_tempo": {
      const bpm = requireNumber(args, "value");
      if (bpm < 20 || bpm > 999) throw new Error("Tempo must be between 20 and 999 BPM.");
      await oscSend("/live/song/set/tempo", [bpm]);
      break;
    }
    case "metronome_on":
    case "metronome_off":
      await oscSend("/live/song/set/metronome", [action === "metronome_on" ? 1 : 0]);
      break;
    case "undo":
      await oscSend("/live/song/undo");
      break;
    case "redo":
      await oscSend("/live/song/redo");
      break;
    default:
      throw new Error(`Unknown transport action "${action}".`);
  }

  const [tempo] = await oscQuery("/live/song/get/tempo");
  const [playing] = await oscQuery("/live/song/get/is_playing");
  const [position] = await oscQuery("/live/song/get/current_song_time");
  return { did: action, playing: bool(playing), tempo: num(tempo), positionBeats: num(position) };
}

async function setLiveTrack(args: Record<string, unknown>): Promise<unknown> {
  await ensureLive();
  const index = requireInt(args, "track_index");
  const action = str(args.action);

  switch (action) {
    case "mute":
    case "unmute":
      await oscSend("/live/track/set/mute", [index, action === "mute" ? 1 : 0]);
      break;
    case "solo":
    case "unsolo":
      await oscSend("/live/track/set/solo", [index, action === "solo" ? 1 : 0]);
      break;
    case "arm":
    case "unarm":
      await oscSend("/live/track/set/arm", [index, action === "arm" ? 1 : 0]);
      break;
    case "rename":
      if (!str(args.name)) throw new Error("rename needs a name.");
      await oscSend("/live/track/set/name", [index, str(args.name)]);
      break;
    case "set_volume": {
      const volume = requireNumber(args, "value");
      if (volume < 0 || volume > 1) throw new Error("Volume is 0..1 (0.85 is 0 dB).");
      await oscSend("/live/track/set/volume", [index, volume]);
      break;
    }
    case "set_pan": {
      const pan = requireNumber(args, "value");
      if (pan < -1 || pan > 1) throw new Error("Pan is -1 (left) .. 1 (right).");
      await oscSend("/live/track/set/panning", [index, pan]);
      break;
    }
    case "stop_clips":
      await oscSend("/live/track/stop_all_clips", [index]);
      break;
    default:
      throw new Error(`Unknown track action "${action}".`);
  }

  const [, name] = await oscQuery("/live/track/get/name", [index]);
  return { did: action, trackIndex: index, trackName: str(name) };
}

async function liveClipSlot(args: Record<string, unknown>): Promise<unknown> {
  await ensureLive();
  const track = requireInt(args, "track_index");
  const clip = requireInt(args, "clip_index");
  const action = str(args.action);

  switch (action) {
    case "fire":
      await oscSend("/live/clip_slot/fire", [track, clip]);
      break;
    case "stop":
      await oscSend("/live/clip_slot/stop", [track, clip]);
      break;
    case "create_clip": {
      const length = requireNumber(args, "length_beats");
      if (length <= 0) throw new Error("length_beats must be positive.");
      const [, , hasClip] = await oscQuery("/live/clip_slot/get/has_clip", [track, clip]);
      if (bool(hasClip)) throw new Error(`Track ${track} slot ${clip} already has a clip.`);
      await oscSend("/live/clip_slot/create_clip", [track, clip, length]);
      break;
    }
    case "delete_clip":
      await oscSend("/live/clip_slot/delete_clip", [track, clip]);
      break;
    case "rename":
      if (!str(args.name)) throw new Error("rename needs a name.");
      await oscSend("/live/clip/set/name", [track, clip, str(args.name)]);
      break;
    case "duplicate_to": {
      const targetTrack = requireInt(args, "target_track_index");
      const targetClip = requireInt(args, "target_clip_index");
      await oscSend("/live/clip_slot/duplicate_clip_to", [track, clip, targetTrack, targetClip]);
      break;
    }
    default:
      throw new Error(`Unknown clip action "${action}".`);
  }

  const [, , hasClip] = await oscQuery("/live/clip_slot/get/has_clip", [track, clip]);
  const name = bool(hasClip) ? str((await oscQuery("/live/clip/get/name", [track, clip]))[2]) : null;
  return { did: action, trackIndex: track, clipIndex: clip, hasClip: bool(hasClip), clipName: name };
}

type NoteInput = {
  pitch?: number;
  note?: string;
  start_beats: number;
  duration_beats: number;
  velocity?: number;
};

async function editLiveClipNotes(args: Record<string, unknown>): Promise<unknown> {
  await ensureLive();
  const track = requireInt(args, "track_index");
  const clip = requireInt(args, "clip_index");
  const action = str(args.action);

  const [, , hasClip] = await oscQuery("/live/clip_slot/get/has_clip", [track, clip]);
  if (!bool(hasClip)) {
    throw new Error(`Track ${track} slot ${clip} is empty. Create a clip there first (live_clip_slot create_clip).`);
  }
  const [, , isMidi] = await oscQuery("/live/clip/get/is_midi_clip", [track, clip]);
  if (!bool(isMidi)) throw new Error(`Track ${track} clip ${clip} is an audio clip; notes can't be edited.`);

  const removeRange = () => {
    const range = (args.range ?? null) as Record<string, unknown> | null;
    if (!range) return oscSend("/live/clip/remove/notes", [track, clip]);
    const pitchMin = Number(range.pitch_min ?? 0);
    const pitchMax = Number(range.pitch_max ?? 127);
    const timeStart = Number(range.start_beats ?? -8192);
    const timeEnd = Number(range.end_beats ?? 8192);
    return oscSend("/live/clip/remove/notes", [
      track,
      clip,
      pitchMin,
      pitchMax - pitchMin + 1,
      timeStart,
      timeEnd - timeStart,
    ]);
  };

  const addNotes = async () => {
    const notes = (Array.isArray(args.notes) ? args.notes : []) as NoteInput[];
    if (notes.length === 0) throw new Error("notes must be a non-empty array.");
    if (notes.length > MAX_NOTES_PER_EDIT) throw new Error(`At most ${MAX_NOTES_PER_EDIT} notes per call.`);

    const flat: number[] = [];
    for (const note of notes) {
      const pitch = note.note ? noteNameToMidi(String(note.note)) : Number(note.pitch);
      if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) {
        throw new Error(`Each note needs a pitch 0-127 or a note name like C3.`);
      }
      const start = Number(note.start_beats);
      const duration = Number(note.duration_beats);
      if (!Number.isFinite(start) || start < 0) throw new Error("Each note needs start_beats >= 0.");
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("Each note needs duration_beats > 0.");
      const velocity = Number.isFinite(Number(note.velocity)) ? Math.min(127, Math.max(1, Number(note.velocity))) : 100;
      flat.push(pitch, start, duration, velocity, 0);
    }
    await oscSend("/live/clip/add/notes", [track, clip, ...flat]);
  };

  if (action === "add") {
    await addNotes();
  } else if (action === "remove") {
    await removeRange();
  } else if (action === "replace") {
    await removeRange();
    await addNotes();
  } else {
    throw new Error(`Unknown notes action "${action}" (add, remove, replace).`);
  }

  const [, , ...flat] = await oscQuery("/live/clip/get/notes", [track, clip], { timeoutMs: 3000 });
  return { did: action, trackIndex: track, clipIndex: clip, noteCount: Math.floor(flat.length / 5) };
}

/** Writes notes into an existing MIDI clip in OSC-sized batches. */
async function writeNotes(track: number, clip: number, notes: ComposedNote[]) {
  for (let offset = 0; offset < notes.length; offset += MAX_NOTES_PER_EDIT) {
    const flat: number[] = [];
    for (const note of notes.slice(offset, offset + MAX_NOTES_PER_EDIT)) {
      flat.push(note.pitch, note.start_beats, note.duration_beats, note.velocity, 0);
    }
    await oscSend("/live/clip/add/notes", [track, clip, ...flat]);
  }
}

/**
 * The collaborator move: the artist describes a part in conversation, a
 * frontier model writes it, and it lands in Live. The voice model does not
 * write the notes itself; it passes the brief to the composer seam so the
 * writing model can be swapped without touching the voice layer.
 */
async function composeMidiPart(args: Record<string, unknown>): Promise<unknown> {
  await ensureLive();
  const track = requireInt(args, "track_index");
  const clip = requireInt(args, "clip_index");
  const brief = str(args.brief).trim();
  if (!brief) throw new Error("compose_midi_part needs a brief describing the part.");

  const lengthBeats = requireNumber(args, "length_beats");
  if (lengthBeats <= 0) throw new Error("length_beats must be positive.");
  const replace = bool(args.replace) || args.replace === "true";
  const instrument = str(args.instrument).trim() || undefined;
  const style = str(args.style).trim() || undefined;

  const [, , hasClip] = await oscQuery("/live/clip_slot/get/has_clip", [track, clip]);
  let created = false;
  if (!bool(hasClip)) {
    await oscSend("/live/clip_slot/create_clip", [track, clip, lengthBeats]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    created = true;
  } else {
    const [, , isMidi] = await oscQuery("/live/clip/get/is_midi_clip", [track, clip]);
    if (!bool(isMidi)) throw new Error(`Track ${track} clip ${clip} is an audio clip; MIDI can't be written to it.`);
  }

  const [tempo] = await oscQuery("/live/song/get/tempo");
  const [sigNum] = await oscQuery("/live/song/get/signature_numerator");
  const [sigDen] = await oscQuery("/live/song/get/signature_denominator");

  // Existing notes are context for a revision, not for a fresh part.
  let existingNotes: ComposedNote[] | undefined;
  if (!created && !replace) {
    const [, , ...flat] = await oscQuery("/live/clip/get/notes", [track, clip], { timeoutMs: 3000 });
    const collected: ComposedNote[] = [];
    for (let offset = 0; offset + 4 < flat.length; offset += 5) {
      collected.push({
        pitch: num(flat[offset]),
        start_beats: num(flat[offset + 1]),
        duration_beats: num(flat[offset + 2]),
        velocity: num(flat[offset + 3]),
      });
    }
    if (collected.length > 0) existingNotes = collected;
  }

  const composed = await composePart({
    brief,
    lengthBeats,
    tempo: num(tempo),
    timeSignature: `${num(sigNum)}/${num(sigDen)}`,
    instrument,
    style,
    existingNotes,
  });

  // A revision returns the complete part, so clearing first is how it lands.
  if (replace || existingNotes) await oscSend("/live/clip/remove/notes", [track, clip]);
  await writeNotes(track, clip, composed.notes);

  const [, , ...after] = await oscQuery("/live/clip/get/notes", [track, clip], { timeoutMs: 3000 });
  return {
    trackIndex: track,
    clipIndex: clip,
    createdClip: created,
    wrote: composed.notes.length,
    noteCount: Math.floor(after.length / 5),
    explanation: composed.explanation,
    backend: composed.backend,
    model: composed.model,
    style,
    ...(instrument ? { instrument } : {}),
  };
}

async function createLiveTrack(args: Record<string, unknown>): Promise<unknown> {
  await ensureLive();
  const type = str(args.type);
  const address: Record<string, string> = {
    midi: "/live/song/create_midi_track",
    audio: "/live/song/create_audio_track",
    return: "/live/song/create_return_track",
    scene: "/live/song/create_scene",
  };
  if (!address[type]) throw new Error(`type must be one of midi, audio, return, scene.`);

  await oscSend(address[type], type === "return" ? [] : [-1]);
  // Creation has no reply; poll the count to confirm before renaming.
  await new Promise((resolve) => setTimeout(resolve, 150));

  if (type === "scene") {
    const [numScenes] = await oscQuery("/live/song/get/num_scenes");
    return { did: "create_scene", sceneCount: num(numScenes) };
  }

  const [numTracks] = await oscQuery("/live/song/get/num_tracks");
  const newIndex = num(numTracks) - 1;
  if (str(args.name)) await oscSend("/live/track/set/name", [newIndex, str(args.name)]);
  const [, name] = await oscQuery("/live/track/get/name", [newIndex]);
  return { did: `create_${type}_track`, trackIndex: newIndex, trackName: str(name) };
}

async function setLiveDeviceParameter(args: Record<string, unknown>): Promise<unknown> {
  await ensureLive();
  const track = requireInt(args, "track_index");
  const device = requireInt(args, "device_index");
  const parameter = requireInt(args, "parameter_index");
  const value = requireNumber(args, "value");

  await oscSend("/live/device/set/parameter/value", [track, device, parameter, value]);
  const [, , , display] = await oscQuery("/live/device/get/parameter/value_string", [track, device, parameter]);
  const [, , , name] = await oscQuery("/live/device/get/parameter/name", [track, device, parameter]);
  return { trackIndex: track, deviceIndex: device, parameter: str(name), nowShowing: str(display) };
}

async function arrangeLiveClip(args: Record<string, unknown>): Promise<unknown> {
  await ensureLive();
  const track = requireInt(args, "track_index");
  const clip = requireInt(args, "clip_index");
  const atBeats = requireNumber(args, "at_beats");
  if (atBeats < 0) throw new Error("at_beats must be >= 0.");

  await oscQuery("/live/track/duplicate_clip_to_arrangement", [track, clip, atBeats], { timeoutMs: 3000 });
  const [, ...starts] = await oscQuery("/live/track/get/arrangement_clips/start_time", [track]);
  return {
    did: "arrange_clip",
    trackIndex: track,
    clipIndex: clip,
    placedAtBeats: atBeats,
    arrangementClipCount: starts.length,
    note: "To hear the arrangement, use live_transport play_arrangement (session clips override it otherwise).",
  };
}

// ---------------------------------------------------------------------------
// Dispatch + declarations
// ---------------------------------------------------------------------------

const HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  get_live_overview: () => getLiveOverview(),
  get_live_track: getLiveTrack,
  get_live_clip: getLiveClip,
  get_live_clip_notes: getLiveClipNotes,
  get_live_arrangement: () => getLiveArrangement(),
  get_live_device_parameters: getLiveDeviceParameters,
  get_live_selection: () => getLiveSelection(),
  live_transport: liveTransport,
  set_live_track: setLiveTrack,
  live_clip_slot: liveClipSlot,
  edit_live_clip_notes: editLiveClipNotes,
  compose_midi_part: composeMidiPart,
  create_live_track: createLiveTrack,
  set_live_device_parameter: setLiveDeviceParameter,
  arrange_live_clip: arrangeLiveClip,
};

export function isAbletonTool(name: string): boolean {
  return name in HANDLERS;
}

export async function runAbletonTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    return { result: await HANDLERS[name](args) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : `Tool ${name} failed.` };
  }
}

export const ABLETON_FUNCTION_DECLARATIONS = [
  {
    name: "get_live_overview",
    description:
      "See the current Ableton Live session: tempo, time signature, whether it's playing, and every track with mute/solo state and which session clip is playing. Call this FIRST whenever the conversation turns to what's happening in Ableton, before any other Live tool. Never guess at session contents.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_live_track",
    description:
      "Detail on one track by index (from get_live_overview): devices, session clips with lengths, volume (0..1, where 0.85 is 0 dB), pan, arm/mute/solo.",
    parameters: {
      type: "OBJECT",
      properties: { track_index: { type: "NUMBER", description: "Zero-based track index." } },
      required: ["track_index"],
    },
  },
  {
    name: "get_live_clip",
    description: "Detail on one session clip: name, length in beats, MIDI or audio, looping, loop range, mute state.",
    parameters: {
      type: "OBJECT",
      properties: {
        track_index: { type: "NUMBER", description: "Zero-based track index." },
        clip_index: { type: "NUMBER", description: "Zero-based clip slot index (scene row)." },
      },
      required: ["track_index", "clip_index"],
    },
  },
  {
    name: "get_live_clip_notes",
    description:
      "The MIDI notes in a clip, with note names (Ableton convention, middle C = C3), start and duration in beats, and velocity. Only valid on MIDI clips; check with get_live_clip or get_live_track first if unsure.",
    parameters: {
      type: "OBJECT",
      properties: {
        track_index: { type: "NUMBER", description: "Zero-based track index." },
        clip_index: { type: "NUMBER", description: "Zero-based clip slot index." },
      },
      required: ["track_index", "clip_index"],
    },
  },
  {
    name: "get_live_arrangement",
    description:
      "The arrangement timeline: every track's arrangement clips with start positions and lengths in beats. Use for questions about song structure ('where does the outro start').",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_live_device_parameters",
    description:
      "Parameter names, values, and ranges for one device on a track. Use before set_live_device_parameter to find the right parameter index and scale.",
    parameters: {
      type: "OBJECT",
      properties: {
        track_index: { type: "NUMBER", description: "Zero-based track index." },
        device_index: { type: "NUMBER", description: "Zero-based device index from get_live_track." },
      },
      required: ["track_index", "device_index"],
    },
  },
  {
    name: "get_live_selection",
    description: "Which track and scene are currently selected in Live. Useful when the artist says 'this track'.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "live_transport",
    description:
      "Control the transport: action is one of play, stop, continue, play_arrangement (clears Back-to-Arrangement first so the timeline is heard), stop_all_clips, jump_to (value = position in beats), set_tempo (value = BPM), metronome_on, metronome_off, undo, redo. Only touch the transport when the artist asks. undo reverses the last edit in Live, including edits made by these tools.",
    parameters: {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", description: "One of the actions listed in the description." },
        value: { type: "NUMBER", description: "Beats for jump_to; BPM for set_tempo." },
      },
      required: ["action"],
    },
  },
  {
    name: "set_live_track",
    description:
      "Change one track: action is mute, unmute, solo, unsolo, arm, unarm, rename (with name), set_volume (value 0..1, 0.85 = 0 dB), set_pan (value -1..1), or stop_clips. Only when the artist asks.",
    parameters: {
      type: "OBJECT",
      properties: {
        track_index: { type: "NUMBER", description: "Zero-based track index." },
        action: { type: "STRING", description: "One of the actions listed in the description." },
        value: { type: "NUMBER", description: "For set_volume / set_pan." },
        name: { type: "STRING", description: "For rename." },
      },
      required: ["track_index", "action"],
    },
  },
  {
    name: "live_clip_slot",
    description:
      "Work a session clip slot: action is fire, stop, create_clip (with length_beats; slot must be empty; makes an empty MIDI clip on a MIDI track), delete_clip (destructive: confirm with the artist out loud first), rename (with name), or duplicate_to (with target_track_index and target_clip_index). fire launches on Live's quantization grid.",
    parameters: {
      type: "OBJECT",
      properties: {
        track_index: { type: "NUMBER", description: "Zero-based track index." },
        clip_index: { type: "NUMBER", description: "Zero-based clip slot index (scene row)." },
        action: { type: "STRING", description: "One of the actions listed in the description." },
        length_beats: { type: "NUMBER", description: "For create_clip, e.g. 16 for 4 bars of 4/4." },
        name: { type: "STRING", description: "For rename." },
        target_track_index: { type: "NUMBER", description: "For duplicate_to." },
        target_clip_index: { type: "NUMBER", description: "For duplicate_to." },
      },
      required: ["track_index", "clip_index", "action"],
    },
  },
  {
    name: "edit_live_clip_notes",
    description:
      "Write MIDI into a clip. action add appends notes; remove deletes notes (everything, or just the given range); replace is remove-then-add (destructive: confirm with the artist out loud before replace or a rangeless remove). Each note: pitch (0-127) OR note (name like C3, F#2; middle C = C3), start_beats, duration_beats, velocity (1-127, default 100). Times are in beats from the clip start. After editing, say what you added ('eight notes, C minor arpeggio over two bars').",
    parameters: {
      type: "OBJECT",
      properties: {
        track_index: { type: "NUMBER", description: "Zero-based track index." },
        clip_index: { type: "NUMBER", description: "Zero-based clip slot index." },
        action: { type: "STRING", description: "add, remove, or replace." },
        notes: {
          type: "ARRAY",
          description: "For add/replace: the notes to write.",
          items: {
            type: "OBJECT",
            properties: {
              pitch: { type: "NUMBER", description: "MIDI pitch 0-127 (or use note instead)." },
              note: { type: "STRING", description: "Note name like C3 or F#2 (middle C = C3)." },
              start_beats: { type: "NUMBER", description: "Start position in beats from clip start." },
              duration_beats: { type: "NUMBER", description: "Length in beats." },
              velocity: { type: "NUMBER", description: "1-127, default 100." },
            },
          },
        },
        range: {
          type: "OBJECT",
          description: "For remove/replace: limit to this range instead of the whole clip.",
          properties: {
            pitch_min: { type: "NUMBER", description: "Lowest MIDI pitch, default 0." },
            pitch_max: { type: "NUMBER", description: "Highest MIDI pitch, default 127." },
            start_beats: { type: "NUMBER", description: "Range start in beats." },
            end_beats: { type: "NUMBER", description: "Range end in beats." },
          },
        },
      },
      required: ["track_index", "clip_index", "action"],
    },
  },
  {
    name: "compose_midi_part",
    description:
      "Write a musical part into a clip. Use this whenever the artist asks for material: a bass line, a percussion groove, an arpeggio, a pad, a fill, a counter-melody. Pass their own words as the brief, plus anything they said about feel, density, or where it should build. It creates the clip when the slot is empty, and takes 20-60 seconds because a frontier model writes the performance. Set replace only after they have confirmed out loud that the existing notes should go; leaving it off treats the clip's contents as a starting point and revises them. For small surgical edits ('make that note longer', 'drop the velocity on the offbeats') use edit_live_clip_notes instead. Afterwards, say the explanation it returns out loud and mention live_transport undo reverses it. Name an instrument doc in the instrument argument when the artist is working with a documented instrument, so articulation keyswitches get used, and a style doc in the style argument when one covers the tradition or instrument being asked for, so the part is idiomatic rather than generic; the session briefing lists which docs exist.",
    parameters: {
      type: "OBJECT",
      properties: {
        track_index: { type: "NUMBER", description: "Zero-based track index." },
        clip_index: { type: "NUMBER", description: "Zero-based clip slot index (scene row)." },
        brief: {
          type: "STRING",
          description:
            "What to write, in the artist's own words plus relevant feel notes, e.g. 'sparse ride-led groove that builds into fills in the last four bars'.",
        },
        length_beats: { type: "NUMBER", description: "Clip length in beats, e.g. 64 for 16 bars of 4/4." },
        instrument: {
          type: "STRING",
          description: "Optional name of an instrument doc in instruments/, for articulation keyswitches.",
        },
        style: {
          type: "STRING",
          description:
            "Optional name of a style doc in styles/, describing how the instrument is really played (stroke vocabulary, rhythmic cycles, phrasing). Pass this whenever the artist names a tradition or an instrument a style doc covers; instrument and style are independent and most parts want both.",
        },
        replace: {
          type: "BOOLEAN",
          description: "Destructive: clears the clip first. Only with the artist's spoken confirmation.",
        },
      },
      required: ["track_index", "clip_index", "brief", "length_beats"],
    },
  },
  {
    name: "create_live_track",
    description: "Create a new midi track, audio track, return track, or scene. Optional name for tracks.",
    parameters: {
      type: "OBJECT",
      properties: {
        type: { type: "STRING", description: "midi, audio, return, or scene." },
        name: { type: "STRING", description: "Optional name for the new track." },
      },
      required: ["type"],
    },
  },
  {
    name: "set_live_device_parameter",
    description:
      "Set one device parameter by index. Always call get_live_device_parameters first to learn the parameter's index and min/max scale; values are in the device's native range, not percentages.",
    parameters: {
      type: "OBJECT",
      properties: {
        track_index: { type: "NUMBER", description: "Zero-based track index." },
        device_index: { type: "NUMBER", description: "Zero-based device index." },
        parameter_index: { type: "NUMBER", description: "From get_live_device_parameters." },
        value: { type: "NUMBER", description: "New value in the parameter's min..max range." },
      },
      required: ["track_index", "device_index", "parameter_index", "value"],
    },
  },
  {
    name: "arrange_live_clip",
    description:
      "Place a session clip onto the arrangement timeline at a beat position (bar 33 in 4/4 = beat 128). The reliable composing loop: build the clip in session view, then place it. Follow with live_transport play_arrangement to hear the timeline.",
    parameters: {
      type: "OBJECT",
      properties: {
        track_index: { type: "NUMBER", description: "Zero-based track index." },
        clip_index: { type: "NUMBER", description: "Session clip slot to copy from." },
        at_beats: { type: "NUMBER", description: "Destination position in beats from song start." },
      },
      required: ["track_index", "clip_index", "at_beats"],
    },
  },
];
