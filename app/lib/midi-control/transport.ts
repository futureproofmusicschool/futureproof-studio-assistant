import JZZ from "jzz";

export type MidiOutput = { name: string; manufacturer?: string };
export type MidiTransport = {
  outputs(): Promise<MidiOutput[]>;
  send(outputName: string, message: number[]): Promise<void>;
};

export const systemMidiTransport: MidiTransport = {
  async outputs() {
    const engine = await JZZ().refresh();
    const info = engine.info() as { outputs?: { name: string; manufacturer?: string }[]; engine?: string };
    if (info.engine === "none") throw new Error("No system MIDI driver is available on this machine.");
    return (info.outputs ?? []).map(({ name, manufacturer }) => ({ name, manufacturer }));
  },
  async send(outputName, message) {
    const outputs = await this.outputs();
    if (outputs.filter((port) => port.name === outputName).length !== 1) {
      throw new Error(`MIDI output "${outputName}" is missing or ambiguous. Check the connection in Settings.`);
    }
    const port = await JZZ().openMidiOut(outputName);
    try {
      await port.send(message);
    } finally {
      await port.close();
    }
  },
};
