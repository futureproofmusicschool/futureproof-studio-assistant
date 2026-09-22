import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dataPath } from "../paths";
import { atomicWrite, readJson, writeJson } from "../runtime/files.js";
import { comparePresets, editPreset, inspectPreset, type PatchEdits } from "./preset";
import { assembleChain, loadAtlas } from "./chain";

const run = promisify(execFile);
const editor = "/Applications/Line6/POD HD Edit.app";
const root = () => dataPath("pod-hd");
function presetPath(id: string) {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid preset identifier.");
  return `${root()}/${id}/preset.hbe`;
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export function readPreset(id: string) {
  const bytes = fs.readFileSync(presetPath(id));
  inspectPreset(bytes);
  return bytes;
}
export function savePreset(bytes: Buffer, parentId?: string) {
  const info = inspectPreset(bytes);
  const id = randomUUID();
  const file = presetPath(id);
  atomicWrite(file, bytes);
  const entry = { id, ...info, sha256: hash(bytes), createdAt: new Date().toISOString(), parentId: parentId ?? null };
  writeJson(file.replace("preset.hbe", "metadata.json"), entry);
  return { ...entry, downloadUrl: `/api/pod-hd/${id}` };
}
export function listPresets() {
  let ids: string[];
  try { ids = fs.readdirSync(root()); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return ids.filter(id => /^[a-f0-9-]{36}$/.test(id)).map(id => {
    const bytes = readPreset(id);
    const metadata = readJson<{createdAt?: string; parentId?: string}>(presetPath(id).replace("preset.hbe", "metadata.json"), {});
    return { id, ...inspectPreset(bytes), sha256: hash(bytes), createdAt: metadata.createdAt ?? "", parentId: metadata.parentId ?? null, downloadUrl: `/api/pod-hd/${id}` };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function createVariation(id: string, edits: PatchEdits) {
  return savePreset(editPreset(readPreset(id), edits), id);
}
export function createChain(id: string, recipe: unknown) {
  const {bytes, receipt} = assembleChain(readPreset(id), loadAtlas(), recipe);
  const preset = savePreset(bytes, id);
  writeJson(`${root()}/${preset.id}/assembly.json`, receipt);
  return {...preset, ...receipt};
}
export function editorStatus() {
  return { available: process.platform === "darwin" && fs.existsSync(editor), transport: "pod-hd-edit", directUsb: false };
}
export async function openInEditor(id: string) {
  readPreset(id);
  if (!editorStatus().available) throw new Error("POD HD Edit is not installed at its standard macOS location. Download the preset and open it manually.");
  await run("/usr/bin/open", ["-a", editor, presetPath(id)], { timeout: 10_000 });
  return { status: "handoff-requested", savedToDevice: false, message: "POD HD Edit was asked to open the preset in its current channel. Review the channel and use Send Selected to save to hardware. This does not confirm the editor loaded it or the device saved it." };
}
export function verifyReadback(id: string, bytes: Buffer) {
  const comparison = comparePresets(readPreset(id), bytes);
  // Preserve the returned bytes even on mismatch for diagnosis; never overwrite the source.
  const readback = savePreset(bytes, id);
  const receipt = { ...comparison, readbackId: readback.id, checkedAt: new Date().toISOString(), evidence: "user-supplied-editor-export" };
  writeJson(`${root()}/${id}/verification-${randomUUID()}.json`, receipt);
  return receipt;
}
