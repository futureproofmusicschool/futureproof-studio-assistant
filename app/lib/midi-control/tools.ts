import { readMidiDevices, type MidiDevice } from "./devices";
import { systemMidiTransport, type MidiTransport } from "./transport";

export function ccMessage(channel: number, cc: number, value: number): number[] {
  if (![channel, cc, value].every(Number.isInteger) || channel < 1 || channel > 16 || cc < 0 || cc > 119 || value < 0 || value > 127) {
    throw new Error("Invalid MIDI control change message.");
  }
  return [0xaf + channel, cc, value];
}

export async function sendNamedParameter(
  devices: MidiDevice[],
  deviceId: string,
  parameterName: string,
  value: number,
  transport: MidiTransport = systemMidiTransport,
) {
  const device = devices.find((item) => item.id === deviceId);
  if (!device) throw new Error("That MIDI device is not configured.");
  if (!device.enabled || !device.outputPort) throw new Error(`${device.name} is not enabled for MIDI output in Settings.`);
  const parameter = device.parameters.find((item) => item.name.toLowerCase() === parameterName.toLowerCase());
  if (!parameter) throw new Error(`${device.name} has no mapped parameter named "${parameterName}".`);
  if (!Number.isInteger(value) || value < parameter.min || value > parameter.max) {
    throw new Error(`${parameter.name} must be an integer from ${parameter.min} to ${parameter.max}.`);
  }
  await transport.send(device.outputPort, ccMessage(device.channel, parameter.cc, value));
  return {
    status: "sent",
    device: device.name,
    parameter: parameter.name,
    value,
    note: "The MIDI message was sent. The pedal's resulting state has not been read back or saved as a preset.",
  };
}

export const MIDI_FUNCTION_DECLARATIONS = [
  {
    name: "list_midi_devices",
    description: "List configured external MIDI devices and their named parameters. Use before changing a pedal. A device must be enabled in Settings before messages can be sent.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "set_midi_parameter",
    description: "Send one mapped MIDI CC value to an external device when the artist asks. Call list_midi_devices first to get the exact device ID, parameter name, and allowed value range. A sent message does not prove the pedal received it or save a preset. Do not claim hardware readback or Live undo.",
    parameters: {
      type: "OBJECT",
      properties: {
        device_id: { type: "STRING", description: "Configured device ID from list_midi_devices." },
        parameter: { type: "STRING", description: "Mapped parameter name from list_midi_devices." },
        value: { type: "NUMBER", description: "Integer MIDI value within that parameter's range." },
      },
      required: ["device_id", "parameter", "value"],
    },
  },
];

export function isMidiControlTool(name: string) {
  return MIDI_FUNCTION_DECLARATIONS.some((tool) => tool.name === name);
}

export async function runMidiControlTool(name: string, args: Record<string, unknown>) {
  try {
    const devices = readMidiDevices();
    if (name === "list_midi_devices") {
      return { result: { devices: devices.map(({ id, name, channel, enabled, parameters }) => ({ id, name, channel, enabled, parameters })) } };
    }
    if (name === "set_midi_parameter") {
      if (typeof args.device_id !== "string" || typeof args.parameter !== "string" || typeof args.value !== "number") {
        throw new Error("Device ID, parameter name, and numeric value are required.");
      }
      return { result: await sendNamedParameter(devices, args.device_id, args.parameter, args.value) };
    }
    throw new Error("Unknown MIDI control tool.");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "MIDI control failed." };
  }
}
