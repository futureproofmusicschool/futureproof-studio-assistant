import fs from "node:fs";
import { readJson, writeJson } from "@/lib/runtime/files.js";
import { dataPath } from "@/lib/paths";

export type MidiParameter = { name: string; cc: number; min: number; max: number };
export type MidiDevice = {
  id: string;
  name: string;
  outputPort: string;
  channel: number;
  enabled: boolean;
  parameters: MidiParameter[];
};

const FILE = dataPath("midi-control", "devices.json");

function integer(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value as number;
}

function label(value: unknown, what: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) {
    throw new Error(`${what} must be 1–80 characters.`);
  }
  return value.trim();
}

export function validateDevices(value: unknown): MidiDevice[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error("Expected up to 32 MIDI devices.");
  const ids = new Set<string>();
  const devices = value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid MIDI device.");
    const raw = entry as Record<string, unknown>;
    const id = label(raw.id, "Device ID");
    if (!/^[a-z0-9-]+$/i.test(id) || ids.has(id)) throw new Error("MIDI device IDs must be unique letters, numbers, or hyphens.");
    ids.add(id);
    const name = label(raw.name, "Device name");
    const outputPort = typeof raw.outputPort === "string" ? raw.outputPort.trim() : "";
    if (outputPort.length > 160) throw new Error("MIDI output name is too long.");
    const channel = integer(raw.channel, 1, 16, `${name} channel`);
    if (typeof raw.enabled !== "boolean") throw new Error(`${name} enabled must be true or false.`);
    if (!Array.isArray(raw.parameters) || raw.parameters.length > 128) {
      throw new Error(`${name} needs a parameter list of at most 128 items.`);
    }
    const names = new Set<string>();
    const parameters = raw.parameters.map((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Invalid ${name} parameter.`);
      const p = item as Record<string, unknown>;
      const parameterName = label(p.name, "Parameter name");
      const key = parameterName.toLowerCase();
      if (names.has(key)) throw new Error(`${name} has a duplicate parameter name.`);
      names.add(key);
      const cc = integer(p.cc, 0, 119, `${parameterName} CC`);
      const min = integer(p.min, 0, 127, `${parameterName} minimum`);
      const max = integer(p.max, min, 127, `${parameterName} maximum`);
      return { name: parameterName, cc, min, max };
    });
    if (raw.enabled && !outputPort) throw new Error(`${name} needs an output port before it can be enabled.`);
    return { id, name, outputPort, channel, enabled: raw.enabled, parameters };
  });
  const enabledDestinations = new Set<string>();
  for (const device of devices) {
    if (!device.enabled) continue;
    const destination = `${device.outputPort}\0${device.channel}`;
    if (enabledDestinations.has(destination)) {
      throw new Error("Enabled devices sharing one MIDI output must use different channels.");
    }
    enabledDestinations.add(destination);
  }
  return devices;
}

export function readMidiDevices(): MidiDevice[] {
  const stored = readJson(FILE, []);
  return validateDevices(stored);
}

export function writeMidiDevices(value: unknown): MidiDevice[] {
  const devices = validateDevices(value);
  fs.mkdirSync(dataPath("midi-control"), { recursive: true, mode: 0o700 });
  writeJson(FILE, devices);
  return devices;
}
