"use client";

import { useCallback, useEffect, useState } from "react";
import { clientFetch } from "@/lib/client-requests";
import type { MidiDevice } from "@/lib/midi-control/devices";

type MidiOutput = { name: string; manufacturer?: string };
type ResponseBody = { devices?: MidiDevice[]; outputs?: MidiOutput[]; portError?: string; error?: string };

export function MidiDevicesPanel() {
  const [devices, setDevices] = useState<MidiDevice[]>([]);
  const [outputs, setOutputs] = useState<MidiOutput[]>([]);
  const [portError, setPortError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const response = await clientFetch("/api/midi-devices", { cache: "no-store" });
      const body = (await response.json()) as ResponseBody;
      if (!response.ok) throw new Error(body.error || "Could not load MIDI devices.");
      setDevices(body.devices ?? []);
      setOutputs(body.outputs ?? []);
      setPortError(body.portError ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load MIDI devices.");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const edit = (id: string, change: Partial<MidiDevice>) => {
    setDevices((current) => current.map((device) => device.id === id ? { ...device, ...change } : device));
    setMessage("");
  };

  const save = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await clientFetch("/api/midi-devices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devices }),
      });
      const body = (await response.json()) as ResponseBody;
      if (!response.ok) throw new Error(body.error || "Could not save MIDI devices.");
      setDevices(body.devices ?? []);
      setMessage("MIDI device setup saved. Hardware state has not changed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save MIDI devices.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="settings-block midi-devices-panel">
    <h2>External MIDI devices</h2>
    <p className="settings-block-hint">Connect a pedal to this machine, choose its exact MIDI output, and map parameters from its manual. Pedals sharing one output must use different MIDI channels, set on the pedals too. Messages stay disabled until you enable each device.</p>
    {portError && <p className="settings-error">{portError}</p>}
    {error && <p className="settings-error">{error}</p>}
    {message && <p className="midi-message">{message}</p>}
    <div className="midi-toolbar">
      <button type="button" onClick={() => void refresh()} disabled={busy}>Refresh MIDI ports</button>
      <button type="button" onClick={() => {
        setDevices((current) => [...current, { id: crypto.randomUUID(), name: "", outputPort: "", channel: 1, enabled: false, parameters: [] }]);
        setMessage("");
      }} disabled={busy}>Add device</button>
      <button type="button" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save setup"}</button>
    </div>
    {devices.map((device) => <div className="midi-device" key={device.id}>
      <div className="midi-device-head">
        <label>Device name<input value={device.name} onChange={(event) => edit(device.id, { name: event.target.value })} placeholder="Pedal name" /></label>
        <label>MIDI output<select value={device.outputPort} onChange={(event) => edit(device.id, { outputPort: event.target.value, enabled: false })}>
          <option value="">Choose when connected</option>
          {device.outputPort && !outputs.some((output) => output.name === device.outputPort) && <option value={device.outputPort}>{device.outputPort} (disconnected)</option>}
          {outputs.map((output) => <option key={output.name} value={output.name}>{output.name}</option>)}
        </select></label>
        <label>MIDI channel<input type="number" min="1" max="16" value={device.channel} onChange={(event) => edit(device.id, { channel: Number(event.target.value), enabled: false })} /></label>
      </div>
      <div className="midi-device-actions">
        <label><input type="checkbox" checked={device.enabled} disabled={!device.outputPort || device.parameters.length === 0} onChange={(event) => edit(device.id, { enabled: event.target.checked })} /> Enable parameter writes</label>
        <button type="button" onClick={() => setDevices((current) => current.filter((item) => item.id !== device.id))}>Remove device</button>
      </div>
      <div className="midi-parameter-header">Mapped MIDI CC parameters</div>
      {device.parameters.map((parameter, index) => <div className="midi-parameter" key={`${device.id}-${index}`}>
        <input aria-label="Parameter name" placeholder="Parameter name" value={parameter.name} onChange={(event) => edit(device.id, { parameters: device.parameters.map((item, i) => i === index ? { ...item, name: event.target.value } : item), enabled: false })} />
        <label>CC<input type="number" min="0" max="119" value={parameter.cc} onChange={(event) => edit(device.id, { parameters: device.parameters.map((item, i) => i === index ? { ...item, cc: Number(event.target.value) } : item), enabled: false })} /></label>
        <label>Min<input type="number" min="0" max="127" value={parameter.min} onChange={(event) => edit(device.id, { parameters: device.parameters.map((item, i) => i === index ? { ...item, min: Number(event.target.value) } : item), enabled: false })} /></label>
        <label>Max<input type="number" min="0" max="127" value={parameter.max} onChange={(event) => edit(device.id, { parameters: device.parameters.map((item, i) => i === index ? { ...item, max: Number(event.target.value) } : item), enabled: false })} /></label>
        <button type="button" onClick={() => edit(device.id, { parameters: device.parameters.filter((_, i) => i !== index), enabled: false })}>Remove</button>
      </div>)}
      <button type="button" onClick={() => edit(device.id, { parameters: [...device.parameters, { name: "", cc: 1, min: 0, max: 127 }], enabled: false })}>Add parameter</button>
    </div>)}
    <p className="settings-block-hint">A sent MIDI CC changes the current sound when the pedal supports it. Saving a preset and confirming the pedal received the value require separate device specific steps.</p>
  </div>;
}
