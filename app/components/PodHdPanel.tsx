"use client";
import { useEffect, useState } from "react";

type Preset = { id: string; name: string; controls: Record<string, number>; controlLabels?: Record<string, string>; downloadUrl: string };
const labels: Record<string, string> = {drive: "Drive", bass: "Bass", mid: "Mid", treble: "Treble", presence: "Presence", channelVolume: "Channel volume"};
const headers = {"x-studio-assistant-action": "pod-hd"};
export function PodHdPanel() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [controls, setControls] = useState<Record<string, number>>({});
  const [available, setAvailable] = useState(false);
  const [mapped, setMapped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const preset = presets.find(p => p.id === selected);
  async function refresh() {
    const response = await fetch("/api/pod-hd", {cache: "no-store"});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setPresets(data.presets); setAvailable(data.editor.available);
    setMapped(data.mapping?.available === true);
  }
  useEffect(() => { refresh().catch(error => setError(error.message)); }, []);
  function select(p: Preset) { setSelected(p.id); setName(p.name); setControls({}); setReady(false); }
  async function perform(work: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : "Operation failed."); }
    finally { setBusy(false); }
  }
  async function post(body: unknown) {
    const response = await fetch("/api/pod-hd", {method: "POST", headers: {...headers, "Content-Type": "application/json"}, body: JSON.stringify(body)});
    const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
  }
  async function upload(file: File, verify: boolean) {
    if (!file.name.toLowerCase().endsWith(".hbe") || file.size !== 4136) throw new Error("Choose a POD HD Bean .hbe preset (4136 bytes).");
    const response = await fetch(`/api/pod-hd${verify ? `?verify=${selected}` : ""}`, {method: "POST", headers: {...headers, "Content-Type": "application/octet-stream"}, body: file});
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    await refresh();
    if (verify) setMessage(data.exactMatch ? "Export matches the generated preset byte for byte. Hardware verification depends on having received this export from the device first." : `Export differs in ${data.changedBytes} bytes. Both files are preserved; the transfer is not verified.`);
    else { select(data); setMessage("Preset imported. The original is preserved when you create variations."); }
  }
  return <div className="settings-block">
    <h2>POD HD Bean</h2>
    <p className="settings-block-hint">Use the controls below to vary the first amp in an imported .hbe preset. Download the result or open it in POD HD Edit for USB transfer.</p>
    {mapped && <p>The Bean model atlas is available. In Talk, ask for an amp and effects chain using one of your templates. Review generated chains in POD HD Edit before saving them to the device.</p>}
    <p>{available ? "POD HD Edit is installed." : "Download presets and open them in POD HD Edit on the connected computer."} Device connection is checked in the editor.</p>
    <label>Import template or backup <input type="file" accept=".hbe" disabled={busy} onChange={e => {const file = e.target.files?.[0]; e.target.value = ""; if(file) void perform(() => upload(file, false));}} /></label>
    {presets.length > 0 && <>
      <p><label>Template <select value={selected} disabled={busy} onChange={e => {const p = presets.find(p => p.id === e.target.value); if(p) select(p);}}><option value="">Choose a preset</option>{presets.map(p => <option key={p.id} value={p.id}>{p.name} · {p.id.slice(0,8)}</option>)}</select></label></p>
      {preset && <>
        <fieldset disabled={busy}>
          <legend>New variation</legend>
          <label>Name <input value={name} maxLength={32} onChange={e => setName(e.target.value)} /></label>
          <div className="pod-controls">{Object.entries(preset.controls).map(([key,value]) => <label key={key}>{preset.controlLabels?.[key] ?? labels[key]} (%)<input type="number" min="0" max="100" step="0.1" value={controls[key] ?? Math.round(value * 1000) / 1000} onChange={e => setControls(previous => ({...previous, [key]: e.target.value === "" ? NaN : Number(e.target.value)}))} /></label>)}</div>
          <button type="button" onClick={() => void perform(async () => {if (Object.values(controls).some(value => !Number.isFinite(value))) throw new Error("Enter a percentage for each edited control."); const created = await post({action: "create", id: selected, edits: {name, controls}}); await refresh(); select(created); setMessage("Variation saved. Download it or open it in the editor below.");})}>Create variation</button>
        </fieldset>
        <p><a href={preset.downloadUrl}>Download selected .hbe</a></p>
        <ol>
          <li>In POD HD Edit, receive your presets from the device and use File → Save Bundle As to keep a backup.</li>
          <li>Select the destination setlist and channel in the editor. Opening a preset replaces that editor channel, including any unsaved edits.</li>
          <li>Open the selected .hbe, review and audition it, then use Send → Selected to save it to that device channel.</li>
          <li>Use Receive → Selected to read it back from the device, then File → Save As to export a new .hbe for comparison below.</li>
        </ol>
        {available && <><label><input type="checkbox" checked={ready} disabled={busy} onChange={e => setReady(e.target.checked)} /> I have backed up my edits and selected the intended editor channel.</label><p><button type="button" disabled={busy || !ready} onClick={() => void perform(async () => {const result = await post({action: "open", id: selected}); setReady(false); setMessage(result.message);})}>Open selected preset in POD HD Edit</button></p></>}
        <label>Compare device readback <input type="file" accept=".hbe" disabled={busy} onChange={e => {const file = e.target.files?.[0]; e.target.value = ""; if(file) void perform(() => upload(file, true));}} /></label>
      </>}
    </>}
    {busy && <p role="status">Working…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
