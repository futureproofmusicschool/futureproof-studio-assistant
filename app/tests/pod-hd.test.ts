import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONTROL_OFFSETS, comparePresets, editPreset, inspectPreset } from "../lib/pod-hd/preset";
import { planChatTools, toolNamesForCategories } from "../lib/chat-tool-routing";
function fixture() {
  const bytes = Buffer.alloc(4136, 0x42);
  bytes.write("H5EP"); bytes[11] = 0x28;
  bytes.fill(0x20, 40, 72); bytes.write("Example", 40);
  for (const offset of Object.values(CONTROL_OFFSETS)) bytes.writeFloatBE(0.5, offset);
  return bytes;
}
test("edits preserve every byte outside explicitly requested fields", () => {
  const original = fixture();
  const changed = editPreset(original, {name: "Variation", controls: {drive: 25}});
  for (let i = 0; i < original.length; i++) if (!(i >= 40 && i < 72) && !(i >= 0x64 && i < 0x68)) assert.equal(changed[i], original[i], `offset ${i}`);
  assert.equal(inspectPreset(changed).controls.drive, 25);
  assert.equal(inspectPreset(original).controls.drive, 50);
  assert.deepEqual(editPreset(original, {}), original);
});
test("rejects wrong models, corrupt values and unsupported edits", () => {
  const bytes = fixture(); bytes[11] = 0x27; assert.throws(() => inspectPreset(bytes));
  assert.throws(() => inspectPreset(Buffer.alloc(4096)));
  for (const value of [NaN, Infinity, -1, 101, "50", null]) assert.throws(() => editPreset(fixture(), {controls: {drive: value as number}}));
  for (const name of ["", " ", "é", "x".repeat(33)]) assert.throws(() => editPreset(fixture(), {name}));
  assert.throws(() => editPreset(fixture(), {controls: {model: 1} as never}));
});
test("readback checks unknown bytes and chat exposes POD tools", () => {
  const bytes = fixture(); const returned = Buffer.from(bytes); returned[3000] ^= 1;
  assert.equal(comparePresets(bytes, bytes).exactMatch, true);
  assert.equal(comparePresets(bytes, returned).changedBytes, 1);
  assert.ok(toolNamesForCategories(planChatTools("Make a POD HD patch")).has("create_pod_hd_preset"));
});
test("empty amp slots remain valid presets but do not expose nonfunctional controls", () => {
  const bytes = fixture(); bytes.writeUInt32BE(0x0007ffff, 0x50); bytes.writeFloatBE(NaN, 0x64);
  assert.deepEqual(inspectPreset(bytes).controls, {});
  assert.throws(() => editPreset(bytes, {controls: {drive: 25}}), /no amplifier/);
  assert.equal(inspectPreset(editPreset(bytes, {name: "No amp"})).name, "No amp");
});
test("private library/API round trip keeps immutable originals and rejects unsafe input", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pod-workflow-"));
  process.env.STUDIO_ASSISTANT_DATA_DIR = root;
  try {
    const library = await import("../lib/pod-hd/library");
    const api = await import("../app/api/pod-hd/route");
    const download = await import("../app/api/pod-hd/[id]/route");
    const request = (body: BodyInit, query = "", header = true) => new Request(`http://localhost/api/pod-hd${query}`, {method: "POST", headers: {"Content-Type": "application/octet-stream", ...(header ? {"x-studio-assistant-action": "pod-hd"} : {})}, body});
    assert.equal((await api.POST(request(new Uint8Array(fixture()), "", false))).status, 403);
    assert.equal((await api.POST(request(new Uint8Array(20_000)))).status, 400);
    const imported = await (await api.POST(request(new Uint8Array(fixture())))).json();
    const varied = library.createVariation(imported.id, {controls: {drive: 25}});
    assert.equal(inspectPreset(library.readPreset(imported.id)).controls.drive, 50);
    assert.equal(inspectPreset(library.readPreset(varied.id)).controls.drive, 25);
    assert.equal(library.listPresets().length, 2);
    assert.throws(() => library.readPreset("../../outside"));
    const response = await download.GET(new Request("http://localhost"), {params: Promise.resolve({id: varied.id})});
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), library.readPreset(varied.id));
    const receipt = await (await api.POST(request(new Uint8Array(library.readPreset(varied.id)), `?verify=${varied.id}`))).json();
    assert.equal(receipt.exactMatch, true);
    assert.equal(receipt.evidence, "user-supplied-editor-export");
    assert.equal(library.editorStatus().directUsb, false);
    const block = Buffer.alloc(256); block.writeUInt32BE(0x02000011);
    block.writeUInt32BE(0x3f100001, 16); block.writeFloatBE(0.5, 20);
    fs.mkdirSync(path.join(root, "pod-hd", "mapping"));
    fs.writeFileSync(path.join(root, "pod-hd", "mapping", "atlas.json"), JSON.stringify({schemaVersion: 1, device: "POD HD Bean", counts: {effect: 1}, models: [{id: "0x02000011", label: "Example gate", kind: "effect", category: "Dynamics", availability: "editor-observed", parameters: [{id: "0x3f100001", label: "Threshold", candidateEncoding: "PerCentParam", binaryType: null, indexShift: 0, bounds: {}, choices: []}], snapshots: [{bytes: block.toString("hex"), sha256: "a".repeat(64), block: "fx3"}]}]}));
    const chainResponse = await api.POST(new Request("http://localhost/api/pod-hd", {method: "POST", headers: {"Content-Type": "application/json", "x-studio-assistant-action": "pod-hd"}, body: JSON.stringify({action: "chain", id: imported.id, recipe: {name: "Example chain", blocks: {fx1: {model: "0x02000011", parameters: {"0x3f100001": 0.25}}}}})}));
    assert.equal(chainResponse.status, 200);
    const composed = await chainResponse.json();
    assert.equal(composed.requiresEditorValidation, true); assert.equal(composed.savedToHardware, false);
    assert.equal(library.readPreset(composed.id).readFloatBE(0x464), 0.25);
    assert.ok(fs.existsSync(path.join(root, "pod-hd", composed.id, "assembly.json")));
    assert.equal((await (await api.GET()).json()).mapping.available, true);
    if (process.platform !== "win32") assert.equal(fs.statSync(path.join(root, "pod-hd", imported.id, "preset.hbe")).mode & 0o777, 0o600);
  } finally {fs.rmSync(root, {recursive: true, force: true}); delete process.env.STUDIO_ASSISTANT_DATA_DIR;}
});
