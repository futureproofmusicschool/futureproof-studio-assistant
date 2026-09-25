import assert from "node:assert/strict";
import test from "node:test";
import { validateDevices } from "../lib/midi-control/devices";
import { ccMessage, sendNamedParameter } from "../lib/midi-control/tools";
import type { MidiTransport } from "../lib/midi-control/transport";

const configured = validateDevices([{
  id: "example-pedal",
  name: "Example Pedal",
  outputPort: "Test Output",
  channel: 3,
  enabled: true,
  parameters: [{ name: "Mix", cc: 15, min: 0, max: 100 }],
}]);

test("one named parameter sends only the mapped MIDI CC to the configured output", async () => {
  const sent: { output: string; bytes: number[] }[] = [];
  const transport: MidiTransport = {
    outputs: async () => [{ name: "Test Output" }],
    send: async (output, bytes) => { sent.push({ output, bytes }); },
  };
  const result = await sendNamedParameter(configured, "example-pedal", "mix", 72, transport);
  assert.deepEqual(sent, [{ output: "Test Output", bytes: [0xb2, 15, 72] }]);
  assert.equal(result.status, "sent");
  assert.match(result.note, /not been read back/);
});

test("invalid values and disabled devices never send MIDI", async () => {
  let count = 0;
  const transport: MidiTransport = {
    outputs: async () => [],
    send: async () => { count++; },
  };
  await assert.rejects(sendNamedParameter(configured, "example-pedal", "Mix", 101, transport), /integer from 0 to 100/);
  await assert.rejects(sendNamedParameter(configured, "example-pedal", "Unknown", 50, transport), /no mapped parameter/);
  await assert.rejects(sendNamedParameter([{ ...configured[0], enabled: false }], "example-pedal", "Mix", 50, transport), /not enabled/);
  assert.equal(count, 0);
  assert.throws(() => ccMessage(17, 1, 1), /Invalid MIDI/);
});

test("device setup rejects unsafe or ambiguous mappings", () => {
  assert.throws(() => validateDevices([{ ...configured[0], parameters: [{ name: "Mix", cc: 123, min: 0, max: 127 }] }]), /CC must be/);
  assert.throws(() => validateDevices([{ ...configured[0], parameters: [...configured[0].parameters, { name: "mix", cc: 16, min: 0, max: 127 }] }]), /duplicate parameter/);
  assert.throws(() => validateDevices([{ ...configured[0], outputPort: "", enabled: true }]), /needs an output port/);
  assert.throws(() => validateDevices([configured[0], { ...configured[0], id: "other-pedal" }]), /different channels/);
});
