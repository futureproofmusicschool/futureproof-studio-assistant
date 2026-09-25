import assert from "node:assert/strict";
import test from "node:test";
import { assembleChain, type Atlas } from "../lib/pod-hd/chain";
import { toolNamesForCategories } from "../lib/chat-tool-routing";

function fixture() {
  const template = Buffer.alloc(4136, 0x42);
  template.write("H5EP"); template[11] = 0x28;
  const block = Buffer.alloc(256, 0x23);
  block.writeUInt32BE(0x02090003, 0);
  block.writeUInt32BE(0x3f001802, 16); block.writeInt32BE(0, 20); block[32] = 3;
  block.writeUInt32BE(0x3f010001, 36); block.writeFloatBE(0.5, 40); block[52] = 2;
  const atlas: Atlas = {schemaVersion: 1, device: "POD HD Bean", counts: {effect: 1}, models: [{id: "0x02090003", label: "Example", kind: "effect", category: "Pitch", availability: "editor-observed", parameters: [
    {id: "0x3f001802", label: "Shift", candidateEncoding: "ListParam", binaryType: "Int32Type", indexShift: -1, bounds: {}, choices: ["Down", "None", "Up"], valueOffsetsInBlock: [20], structureStatus: "editor-observed"},
    {id: "0x3f010001", label: "Mix", candidateEncoding: "PerCentParam", binaryType: null, indexShift: 0, bounds: {}, choices: [], valueOffsetsInBlock: [40], structureStatus: "editor-observed"},
  ], snapshots: [{bytes: block.toString("hex"), sha256: "a".repeat(64), block: "fx4"}]}]};
  return {template, atlas, block};
}
test("chain composition relocates observed blocks but preserves template topology and unknown bytes", () => {
  const {template, atlas, block} = fixture();
  const original = Buffer.from(template);
  const {bytes, receipt} = assembleChain(template, atlas, {name: "Example chain", blocks: {fx2: {model: "0x02090003", parameters: {"0x3f001802": -1, "0x3f010001": 0.25}}}, tempo: 145.5});
  assert.deepEqual(template, original);
  assert.equal(bytes.readUInt32BE(0x550), 0x02090003);
  assert.deepEqual(bytes.subarray(0x554, 0x558), template.subarray(0x554, 0x558));
  assert.equal(bytes.readInt32BE(0x564), -1);
  assert.equal(bytes.readFloatBE(0x578), 0.25);
  assert.equal(bytes[0x570], 0); assert.equal(bytes[0x584], 0);
  assert.equal(bytes[0x55b], 1); assert.equal(bytes[0x559], 0); assert.equal(bytes[0x55a], 0);
  assert.equal(bytes[0x57f], block[0x2f]);
  for (let i = 0; i < bytes.length; i++) if (!(i >= 40 && i < 72) && !(i >= 0x550 && i < 0x650) && !(i >= 0xd80 && i < 0xd84)) assert.equal(bytes[i], template[i]);
  assert.equal(receipt.requiresEditorValidation, true); assert.equal(receipt.savedToHardware, false);
});
test("candidate display conversion is explicit and signed choices retain their sign", () => {
  const {template, atlas} = fixture();
  const recipe = {name: "Example", blocks: {fx1: {model: "0x02090003", displayParameters: {"0x3f001802": "Down", "0x3f010001": 37}}}};
  assert.throws(() => assembleChain(template, atlas, recipe), /allowCandidateConversions/);
  const {bytes} = assembleChain(template, atlas, {...recipe, allowCandidateConversions: true});
  assert.equal(bytes.readInt32BE(0x464), -1);
  assert.ok(Math.abs(bytes.readFloatBE(0x478) - 0.37) < 1e-6);
});
test("unknown models, parameters, blocks, encodings and malformed recipe values fail closed", () => {
  const {template, atlas} = fixture();
  for (const change of [
    {fx9: {model: "0x02090003"}}, {ampA: {model: "0x02090003"}}, {fx1: {model: "unknown"}},
    {fx1: {model: "0x02090003", parameters: {"0x00000000": 1}}},
    {fx1: {model: "0x02090003", parameters: {"0x3f001802": 0.5}}},
    {fx1: {model: "0x02090003", parameters: {"0x3f010001": NaN}}},
    {fx1: {model: "0x02090003", snapshot: 0.5}}, {fx1: {model: "0x02090003", enabled: "false"}},
    {fx1: {model: "0x02090003", footswitch: 0.5}}, {fx1: {model: "0x02090003", tempoSync: 7}},
  ]) assert.throws(() => assembleChain(template, atlas, {name: "Example", blocks: change}));
  for (const recipe of [null, [], {name: ""}, {name: "Example", mixer: {unknown: 1}}, {name: "Example", tempo: 999}]) assert.throws(() => assembleChain(template, atlas, recipe));
  assert.ok(toolNamesForCategories(new Set(["pod_hd"] as const)).has("create_pod_hd_chain"));
});
test("branch routing rejects serial templates and incomplete or duplicate orders", () => {
  const {template, atlas} = fixture();
  const routing = {pre: ["fx1", "fx3", "fx4"], aPre: ["fx2"], bPost: ["fx5"], post: ["fx6", "fx7", "fx8"]};
  assert.throws(() => assembleChain(template, atlas, {name: "Example", routing}), /parallel/);
  template[0x57] = 0;
  const {bytes} = assembleChain(template, atlas, {name: "Example", routing});
  assert.equal(bytes[0x555], 1); assert.equal(bytes[0x557], 3);
  assert.equal(bytes[0x855], 4); assert.equal(bytes[0x857], 4);
  assert.throws(() => assembleChain(template, atlas, {name: "Example", routing: {pre: ["fx1"]}}), /exactly once/);
  assert.throws(() => assembleChain(template, atlas, {name: "Example", routing: {...routing, post: ["fx6", "fx7", "fx7"]}}), /exactly once/);
});
test("cabinet parameters write fixed deep fields and separate A/B global fields", () => {
  const {template, atlas, block} = fixture();
  block.writeUInt32BE(0x01070006);
  const percent = {...atlas.models[0].parameters[1], id: "CabERID"};
  atlas.models = [{...atlas.models[0], id: "0x01070006", kind: "cab", parameters: [percent, {...percent, id: "CabLowCutID"}, {...atlas.models[0].parameters[0], id: "CabMicID", indexShift: 0, choices: ["First", "Second"]}], snapshots: [{bytes: block.toString("hex"), sha256: "a".repeat(64), block: "cabA"}]}];
  const {bytes} = assembleChain(template, atlas, {name: "Example", blocks: {cabB: {model: "0x01070006", parameters: {CabERID: 0.25, CabLowCutID: 0.5, CabMicID: 1}}}});
  assert.equal(bytes.readFloatBE(0xd7c), 0.25); assert.equal(bytes.readFloatBE(0x364), 0.5); assert.equal(bytes[0x1021], 1);
  assert.deepEqual(bytes.subarray(0xd74,0xd7c), template.subarray(0xd74,0xd7c)); assert.equal(bytes[0x1020], template[0x1020]);
});

test("controller assignments preserve typed ranges and reject unsupported sources", () => {
  const {template, atlas} = fixture();
  const request = {model: "0x02090003", controllers: {"0x3f010001": {source: 1, minimum: 0.2, maximum: 0.8}}};
  const {bytes} = assembleChain(template, atlas, {name: "Controller", blocks: {fx1: request}});
  assert.equal(bytes[0x484], 1);
  assert.ok(Math.abs(bytes.readFloatBE(0x47c) - 0.2) < 1e-6);
  assert.ok(Math.abs(bytes.readFloatBE(0x480) - 0.8) < 1e-6);
  assert.throws(() => assembleChain(template, atlas, {name: "Bad", blocks: {fx1: {...request, controllers: {"0x3f010001": {source: 4}}}}}), /number/);
  atlas.models[0].snapshots[0].completeParameterLayout = false;
  assert.throws(() => assembleChain(template, atlas, {name: "Bad", blocks: {fx1: request}}), /Incomplete/);
});

test("shifted float menus reject the blank endpoint and encode the final named choice", () => {
  const {template, atlas} = fixture();
  Object.assign(atlas.models[0].parameters[1], {candidateEncoding: "ListParam", binaryType: "float32Type", indexShift: 1, choices: ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth"]});
  assert.throws(() => assembleChain(template, atlas, {name: "Bad", blocks: {fx1: {model: "0x02090003", parameters: {"0x3f010001": 1}}}}), /number/);
  const {bytes} = assembleChain(template, atlas, {name: "Menu", allowCandidateConversions: true, blocks: {fx1: {model: "0x02090003", displayParameters: {"0x3f010001": "Eighth"}}}});
  assert.equal(bytes.readFloatBE(0x478), 0.875);
});

test("Stereo Delay has independent left and right subdivisions", () => {
  const {template, atlas, block} = fixture();
  block.writeUInt32BE(0x02020013);
  atlas.models[0].id = "0x02020013";
  atlas.models[0].snapshots[0].bytes = block.toString("hex");
  atlas.models[0].parameters[1].candidateEncoding = "TempoFollowerParam";
  const {bytes} = assembleChain(template, atlas, {name: "Stereo", blocks: {fx1: {model: "0x02020013", tempoSync: 2, tempoSyncRight: 20}}});
  assert.equal(bytes[0x459], 2); assert.equal(bytes[0x45a], 20);
  assert.throws(() => assembleChain(template, atlas, {name: "Bad", blocks: {fx1: {model: "0x02020013", tempoSyncRight: 1}}}), /Right tempo/);
});
