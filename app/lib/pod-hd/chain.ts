/** Bean block composition from a private, editor-observed atlas. No USB access. */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { dataPath } from "../paths";

type Parameter = { id: string; label: string; candidateEncoding: string; binaryType: string | null; indexShift: number; bounds: Record<string, number>; choices: string[]; valueOffsetsInBlock: number[]; structureStatus: string; editable?: boolean };
type Snapshot = { bytes: string; sha256: string; block: string; completeParameterLayout?: boolean };
type Model = { id: string; label: string; kind: string; category: string; availability: string; parameters: Parameter[]; snapshots: Snapshot[] };
export type Atlas = { schemaVersion: number; device: string; counts: Record<string, number>; models: Model[] };
export const BLOCK_OFFSETS: Record<string, number> = {ampA: 0x50, ampB: 0x150, cabA: 0x250, cabB: 0x350, ...Object.fromEntries(Array.from({length: 8}, (_, i) => [`fx${i + 1}`, 0x450 + i * 256]))};
const atlasPath = () => dataPath("pod-hd", "mapping", "atlas.json");
export function loadAtlas(): Atlas {
  if (!fs.existsSync(atlasPath())) throw new Error("No Bean mapping atlas is installed. Capture editor exports and build the private atlas first.");
  const atlas = JSON.parse(fs.readFileSync(atlasPath(), "utf8"));
  if (atlas.schemaVersion !== 1 || atlas.device !== "POD HD Bean" || !Array.isArray(atlas.models)) throw new Error("Unsupported Bean mapping atlas.");
  return atlas;
}
export function mappingStatus() {
  if (!fs.existsSync(atlasPath())) return {available: false};
  const atlas = loadAtlas();
  return {available: true, counts: atlas.counts, editorValidationRequired: true};
}
export function listModels(query = "") {
  const atlas = loadAtlas();
  return atlas.models.filter(model => model.availability === "editor-observed" && `${model.id} ${model.label} ${model.category}`.toLowerCase().includes(query.toLowerCase())).map(({snapshots: _snapshots, ...model}) => query.trim() ? model : {id: model.id, label: model.label, kind: model.kind, category: model.category, parameterCount: model.parameters.length});
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a named object.");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unsupported field: ${key}`);
}
function number(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Expected a number from ${min} to ${max}.`);
  return value;
}
function encoded(parameter: Parameter, input: unknown, display: boolean) {
  let value = input;
  const kind = parameter.candidateEncoding;
  const shift = parameter.indexShift ?? 0;
  if (kind === "ListParam") {
    if (display) {
      const index = parameter.choices.indexOf(String(value));
      if (index < 0) throw new Error(`${parameter.label}: choose ${parameter.choices.join(", ")}.`);
      value = parameter.binaryType === "Int32Type" ? index + shift : index / Math.max(1, parameter.choices.length - 1 + shift);
    }
    if (parameter.binaryType === "Int32Type") {
      const integer = number(value, shift, parameter.choices.length - 1 + shift);
      if (!Number.isInteger(integer)) throw new Error("Expected an integer choice.");
      const bytes = Buffer.alloc(4); bytes.writeInt32BE(integer); return bytes;
    }
    const denominator = Math.max(1, parameter.choices.length - 1 + shift);
    const choice = number(value, 0, (parameter.choices.length - 1) / denominator) * denominator;
    if (Math.abs(choice - Math.round(choice)) > 1e-5) throw new Error("Use a named choice or an exact encoded choice value.");
  } else if (display) {
    const bounds = parameter.bounds;
    const [min, max] = kind === "PerCentParam" ? [0, 100] : kind === "TimeParam" ? [0, bounds.maxMs] : [bounds.min, bounds.max];
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) throw new Error("No display conversion is mapped for this parameter.");
    value = (number(value, min, max) - min) / (max - min);
  }
  const bytes = Buffer.alloc(4); bytes.writeFloatBE(number(value, 0, 1)); return bytes;
}

export function assembleChain(template: Buffer, atlas: Atlas, input: unknown) {
  if (template.length !== 4136 || template.toString("ascii", 0, 4) !== "H5EP" || template[11] !== 0x28) throw new Error("Expected a Bean template.");
  const recipe = object(input);
  keys(recipe, ["name", "blocks", "tempo", "mixer", "routing", "allowCandidateConversions"]);
  if (typeof recipe.name !== "string" || !/^[\x20-\x7e]{1,32}$/.test(recipe.name) || !recipe.name.trim()) throw new Error("Use a 1–32 character ASCII preset name.");
  const output = Buffer.from(template);
  output.fill(0x20, 40, 72); output.write(recipe.name, 40, "ascii");
  const sources = [];
  for (const [target, settings] of Object.entries(object(recipe.blocks ?? {}))) {
    if (!Object.hasOwn(BLOCK_OFFSETS, target)) throw new Error(`Unknown block: ${target}`);
    const request = object(settings);
    keys(request, ["model", "snapshot", "enabled", "parameters", "displayParameters", "tempoSync", "tempoSyncRight", "footswitch", "controllers"]);
    const base = BLOCK_OFFSETS[target];
    const kind = target.startsWith("amp") ? "amp" : target.startsWith("cab") ? "cab" : "effect";
    const model = atlas.models.find(model => model.id === request.model && model.kind === kind && model.availability === "editor-observed");
    if (!model) throw new Error(`Model unavailable for ${target}. Use list_pod_hd_models to choose an observed model.`);
    const index = number(request.snapshot ?? 0, 0, model.snapshots.length - 1);
    if (!Number.isInteger(index)) throw new Error("Snapshot must be an integer.");
    const sample = model.snapshots[index];
    if (sample.completeParameterLayout === false) throw new Error("Incomplete captured parameter layout. Choose a complete snapshot.");
    if (!/^[a-f\d]{512}$/i.test(sample.bytes)) throw new Error("Corrupt atlas block.");
    const block = Buffer.from(sample.bytes, "hex");
    if (`0x${block.readUInt32BE().toString(16).padStart(8, "0")}` !== model.id) throw new Error("Atlas model ID mismatch.");
    output.copy(block, 4, base + 4, base + 8);
    if (request.enabled !== undefined && typeof request.enabled !== "boolean") throw new Error("enabled must be boolean.");
    block[8] = request.enabled === false || model.label === "None" ? 0 : 1;
    block[11] = model.label === "None" ? 0 : 1; // Slot presence is independent of bypass.
    if (kind === "effect") {block[9] = 0; block[10] = 0;} // Do not inherit a prior model's sync modes.
    const footswitch = number(request.footswitch ?? 0, 0, 8);
    if (!Number.isInteger(footswitch)) throw new Error("Footswitch must be an integer.");
    block[12] = footswitch;
    if (request.tempoSync !== undefined) {
      const sync = number(request.tempoSync, 0, 20);
      if (!Number.isInteger(sync) || sync === 1 || !(model.parameters.some(p => p.candidateEncoding === "TempoFollowerParam") || ["0x02030026", "0x02030027"].includes(model.id))) throw new Error("Unknown or unsupported tempo sync setting.");
      block[9] = sync;
    }
    if (request.tempoSyncRight !== undefined) {
      const sync = number(request.tempoSyncRight, 0, 20);
      if (model.id !== "0x02020013" || !Number.isInteger(sync) || sync === 1) throw new Error("Right tempo sync is available only on Stereo Delay.");
      block[10] = sync;
    }
    const offsets = new Map<string, number>();
    for (let offset = 16; offset <= 236; offset += 20) {
      const id = block.readUInt32BE(offset);
      if (id >>> 24 === 0x3f) {offsets.set(`0x${id.toString(16).padStart(8, "0")}`, offset + 4); block[offset + 16] = 0;}
    }
    if (kind === "cab") for (const [id, offset] of Object.entries({cablowcutid: 20, cabreslevelid: 40, cabthumpid: 60, cabdecayid: 80})) offsets.set(id, offset);
    for (const [field, display] of [["parameters", false], ["displayParameters", true]] as const) {
      const values = object(request[field] ?? {});
      if (display && Object.keys(values).length && recipe.allowCandidateConversions !== true) throw new Error("Display conversions require allowCandidateConversions and review in POD HD Edit.");
      for (const [key, value] of Object.entries(values)) {
        const parameter = model.parameters.find(p => p.id.toLowerCase() === key.toLowerCase());
        if (parameter?.editable === false) throw new Error(`${parameter.label} is not available on this model.`);
        const offset = offsets.get(key.toLowerCase());
        if (parameter && kind === "cab" && ["caberid", "cabmicid"].includes(key.toLowerCase())) {
          const valueBytes = encoded(parameter, value, display);
          if (key.toLowerCase() === "caberid") valueBytes.copy(output, target === "cabA" ? 0xd74 : 0xd7c);
          else output[target === "cabA" ? 0x1020 : 0x1021] = valueBytes.readInt32BE();
          continue;
        }
        if (!parameter || offset === undefined) throw new Error(`Unmapped parameter ${key} on ${target}.`);
        encoded(parameter, value, display).copy(block, offset);
      }
    }
    for (const [id, input] of Object.entries(object(request.controllers ?? {}))) {
      const assignment = object(input);
      keys(assignment, ["source", "minimum", "maximum"]);
      const parameter = model.parameters.find(p => p.id.toLowerCase() === id.toLowerCase());
      const offset = offsets.get(id.toLowerCase());
      if (kind === "cab" || !parameter || parameter.editable === false || offset === undefined) throw new Error("Unmapped controller parameter.");
      const source = number(assignment.source, 0, 3);
      if (!Number.isInteger(source)) throw new Error("Controller source must be 0, 1, 2 or 3.");
      block[offset + 12] = source;
      if (assignment.minimum !== undefined) encoded(parameter, assignment.minimum, false).copy(block, offset + 4);
      if (assignment.maximum !== undefined) encoded(parameter, assignment.maximum, false).copy(block, offset + 8);
    }
    block.copy(output, base);
    sources.push({target, model: model.id, sourceSha256: sample.sha256, sourceBlock: sample.block});
  }
  // Complete permutation avoids duplicate positions and makes ordering explicit.
  if (recipe.routing !== undefined) {
    const routing = object(recipe.routing);
    const zones: Record<string, number> = {pre: 0, aPre: 1, bPre: 2, aPost: 3, bPost: 4, post: 5};
    keys(routing, Object.keys(zones));
    const entries = Object.entries(routing).flatMap(([zone, list]) => {
      if (!Array.isArray(list) || list.some(block => typeof block !== "string" || !/^fx[1-8]$/.test(block))) throw new Error("Routing requires arrays of fx1..fx8.");
      if (zones[zone] > 0 && zones[zone] < 5 && list.length && output[0x57] !== 0) throw new Error("Branch effects require a parallel-amp routing template.");
      return list.map(block => ({zone: zones[zone], block: block as string}));
    });
    if (entries.length !== 8 || new Set(entries.map(entry => entry.block)).size !== 8) throw new Error("Routing must include each of the eight effect slots exactly once, including empty slots.");
    entries.forEach(({zone, block}, order) => {const base = BLOCK_OFFSETS[block]; output[base + 5] = zone; output[base + 7] = order;});
  }
  if (recipe.tempo !== undefined) output.writeFloatBE(number(recipe.tempo, 30, 240), 0xd80);
  const mixerFields: Record<string, [number, number, number]> = {panA: [0xd84,-1,1], panB: [0xd88,-1,1], levelA: [0xd8c,-60,12], levelB: [0xd90,-60,12]};
  for (const [key, value] of Object.entries(object(recipe.mixer ?? {}))) {
    if (!Object.hasOwn(mixerFields, key)) throw new Error(`Unknown mixer field ${key}`);
    const [offset, min, max] = mixerFields[key]; output.writeFloatBE(number(value, min, max), offset);
  }
  return {bytes: output, receipt: {sources, sha256: createHash("sha256").update(output).digest("hex"), requiresEditorValidation: true, savedToHardware: false}};
}
