import { createChain, createVariation, editorStatus, listPresets, openInEditor, readPreset } from "./library";
import { listModels, mappingStatus } from "./chain";
import { inspectPreset, type PatchEdits } from "./preset";
const controlNames = ["drive", "bass", "mid", "treble", "presence", "channelVolume"];
export const POD_HD_FUNCTION_DECLARATIONS = [
  { name: "list_pod_hd_models", description: "Search the private Bean editor-observed model atlas by name, category or model ID. Returns parameter IDs, candidate display ranges and choices, and evidence status. Query before assembling chains. Observed structure does not establish all parameter semantics or DSP feasibility.", parameters: {type: "OBJECT", properties: {query: {type: "STRING"}}} },
  { name: "create_pod_hd_chain", description: "Assemble a new Bean .hbe chain from an imported template and the private mapping atlas. Use list_pod_hd_models first. Amp topology and untouched blocks remain; routing defaults to the template. Optional routing maps pre/aPre/bPre/aPost/bPost/post to ordered arrays containing fx1..fx8 exactly once, including empty slots; branch placements require a parallel template. Replaced blocks clear captured expression assignments unless controllers are explicitly supplied. recipe is a JSON object string with name, blocks keyed ampA/ampB/cabA/cabB/fx1..fx8, optional tempo (30–240) and mixer (panA/B -1..1, levelA/B dB). Each block has model ID, optional enabled, parameters keyed parameter ID (raw normalized float or integer choice), or displayParameters (catalog display units/choice strings, requires top-level allowCandidateConversions:true). Optional tempoSync:0 off,2 whole,3 dotted half,4 half,5 triplet half,6 dotted quarter,7 quarter,8 triplet quarter, continuing to20 triplet64th. Stereo Delay also accepts tempoSyncRight with the same codes. footswitch is 0 (none) or 1..8. controllers maps parameter IDs to {source:0 Off/1 EXP1/2 EXP2/3 Tweak,minimum:raw value,maximum:raw value}. Cabinet parameter IDs are CabERID, CabLowCutID, CabResLevelID, CabThumpID, CabDecayID, CabMicID. Select None models to clear slots. Uses captured snapshots, not factory defaults. ALWAYS disclose that POD HD Edit must validate values and DSP limits; this does not save to hardware. Return download link.", parameters: {type: "OBJECT", properties: {id: {type: "STRING", description: "Imported routing template ID"}, recipe: {type: "STRING", description: "JSON recipe"}}, required: ["id", "recipe"]} },
  { name: "list_pod_hd_presets", description: "List private POD HD Bean .hbe templates and variations, plus editor availability. Templates must first be imported in Settings. USB transfers use POD HD Edit; direct USB writes are unavailable.", parameters: { type: "OBJECT", properties: {} } },
  { name: "read_pod_hd_preset", description: "Read a library preset's name, first amplifier controls (percent), control labels, block model IDs and routing bytes.", parameters: { type: "OBJECT", properties: { id: {type: "STRING"} }, required: ["id"] } },
  { name: "create_pod_hd_preset", description: "Create an immutable .hbe variation from an imported Bean preset. Preserves all effects, models, routing, controller assignments and unknown bytes. Only first-amp main controls and name can be changed; do not promise arbitrary sound design or device writes. Return the download link to the artist.", parameters: { type: "OBJECT", properties: { id: {type: "STRING"}, name: {type: "STRING", description: "1–32 printable ASCII characters"}, controls: { type: "OBJECT", properties: Object.fromEntries(controlNames.map(key => [key, {type: "NUMBER", description: "Percentage, 0–100"}])) } }, required: ["id"] } },
  { name: "open_pod_hd_preset", description: "On explicit request, ask POD HD Edit to open a library preset. Replaces the currently loaded editor channel, so first tell the artist to back up unsaved edits and select the destination. This is only an editor handoff, never a confirmed hardware save. Artist must use Send Selected and Receive Selected in the editor.", parameters: { type: "OBJECT", properties: { id: {type: "STRING"} }, required: ["id"] } },
];
export function isPodHdTool(name: string) { return POD_HD_FUNCTION_DECLARATIONS.some(tool => tool.name === name); }
export async function runPodHdTool(name: string, args: Record<string, unknown>) {
  try {
    if (name === "list_pod_hd_presets") return { result: { presets: listPresets(), editor: editorStatus(), mapping: mappingStatus() } };
    if (name === "list_pod_hd_models") return {result: listModels(typeof args.query === "string" ? args.query : "")};
    if (typeof args.id !== "string") throw new Error("A preset identifier is required.");
    if (name === "read_pod_hd_preset") return { result: inspectPreset(readPreset(args.id)) };
    if (name === "create_pod_hd_chain") {
      if (typeof args.recipe !== "string" || args.recipe.length > 16_384) throw new Error("Expected a bounded JSON chain recipe.");
      return {result: createChain(args.id, JSON.parse(args.recipe))};
    }
    if (name === "create_pod_hd_preset") {
      const edits: PatchEdits = {};
      if (args.name !== undefined) edits.name = args.name as string;
      if (args.controls !== undefined) edits.controls = args.controls as PatchEdits["controls"];
      return { result: createVariation(args.id, edits) };
    }
    if (name === "open_pod_hd_preset") return { result: await openInEditor(args.id) };
    throw new Error("Unknown POD HD tool.");
  } catch (error) { return { error: error instanceof Error ? error.message : "POD HD operation failed." }; }
}
