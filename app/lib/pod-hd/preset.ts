/** Lossless POD HD Desktop preset edits. Offsets refer to the complete .hbe file.
 * Format reference: https://github.com/johanneszab/podhd/tree/master/docs
 * Only the name and first amplifier's six main controls are writable.
 */
export const PRESET_BYTES = 4136;
export const CONTROL_OFFSETS = {
  drive: 0x64, bass: 0x78, mid: 0x8c, treble: 0xa0, presence: 0xb4, channelVolume: 0xc8,
} as const;
export type Control = keyof typeof CONTROL_OFFSETS;
export type PatchEdits = { name?: string; controls?: Partial<Record<Control, number>> };

export function inspectPreset(bytes: Buffer) {
  if (bytes.length !== PRESET_BYTES || bytes.toString("ascii", 0, 4) !== "H5EP" || bytes[11] !== 0x28) {
    throw new Error("Expected a 4136-byte POD HD Desktop/Bean .hbe preset. Other POD models and bundles are not supported.");
  }
  const controls: Partial<Record<Control, number>> = {};
  const hasAmpA = bytes.readUInt32BE(0x50) !== 0x0007ffff;
  for (const [key, offset] of hasAmpA ? Object.entries(CONTROL_OFFSETS) : []) {
    const value = bytes.readFloatBE(offset);
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Unsupported ${key} encoding in this preset.`);
    controls[key as Control] = value * 100;
  }
  const blocks = [ ["ampA", 0x50], ["ampB", 0x150], ["cabA", 0x250], ["cabB", 0x350], ...Array.from({length: 8}, (_, i) => [`fx${i + 1}`, 0x450 + i * 256]) ].map(([name, start]) => {
    const base = start as number;
    return {block: name as string, modelId: `0x${bytes.readUInt32BE(base).toString(16).padStart(8, "0")}`, enabled: bytes[base + 8] === 1, routingHex: bytes.subarray(base + 4, base + 8).toString("hex")};
  });
  const flipTop = [0x0007005b, 0x0007005c].includes(bytes.readUInt32BE(0x50));
  const controlLabels = {drive: "Drive", bass: "Bass", mid: flipTop ? "Lo Mid" : "Mid", treble: flipTop ? "Hi Mid" : "Treble", presence: "Presence", channelVolume: "Channel volume"};
  const model = bytes.readUInt32BE(0x50);
  if ([0x0007000e, 0x00070029].includes(model)) controlLabels.mid = "Tone";
  if ([0x00070010, 0x00070011, 0x0007002b, 0x0007002c].includes(model)) controlLabels.mid = "Cut";
  if ([0x00070012, 0x0007002d].includes(model)) Object.assign(controlLabels, {drive: "Drive 1", bass: "Drive 2", mid: "Tone", treble: "Cut"});
  return { name: bytes.toString("ascii", 40, 72).replace(/[\0 ]+$/, ""), controls, controlLabels, blocks };
}

export function editPreset(source: Buffer, edits: PatchEdits) {
  inspectPreset(source);
  if (!edits || typeof edits !== "object" || Array.isArray(edits)) throw new Error("Expected preset edits.");
  for (const key of Object.keys(edits)) if (key !== "name" && key !== "controls") throw new Error(`Unsupported edit: ${key}`);
  const output = Buffer.from(source);
  if (edits.name !== undefined) {
    if (typeof edits.name !== "string" || !/^[\x20-\x7e]{1,32}$/.test(edits.name) || !edits.name.trim()) {
      throw new Error("Preset names must contain 1–32 printable ASCII characters.");
    }
    output.fill(0x20, 40, 72);
    output.write(edits.name, 40, "ascii");
  }
  if (edits.controls !== undefined) {
    if (!edits.controls || typeof edits.controls !== "object" || Array.isArray(edits.controls)) throw new Error("Expected named controls.");
    if (Object.keys(edits.controls).length && source.readUInt32BE(0x50) === 0x0007ffff) throw new Error("The template has no amplifier in slot A. Add an amp with chain creation first.");
    for (const [key, value] of Object.entries(edits.controls)) {
      if (!Object.hasOwn(CONTROL_OFFSETS, key)) throw new Error(`Unsupported control: ${key}`);
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${key} must be a percentage from 0 to 100.`);
      output.writeFloatBE(value / 100, CONTROL_OFFSETS[key as Control]);
    }
  }
  return output;
}

export function comparePresets(expected: Buffer, received: Buffer) {
  const before = inspectPreset(expected);
  const after = inspectPreset(received);
  let changedBytes = 0;
  for (let i = 0; i < expected.length; i++) if (expected[i] !== received[i]) changedBytes++;
  return { exactMatch: changedBytes === 0, changedBytes, expected: before, received: after };
}
