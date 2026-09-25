import { NextResponse } from "next/server";
import { readMidiDevices, writeMidiDevices } from "@/lib/midi-control/devices";
import { systemMidiTransport } from "@/lib/midi-control/transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const devices = readMidiDevices();
    try {
      return NextResponse.json({ devices, outputs: await systemMidiTransport.outputs() });
    } catch (error) {
      return NextResponse.json({
        devices,
        outputs: [],
        portError: error instanceof Error ? error.message : "MIDI outputs could not be read.",
      });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "MIDI devices could not be read." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { devices?: unknown };
    return NextResponse.json({ devices: writeMidiDevices(body.devices) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "MIDI devices could not be saved." }, { status: 400 });
  }
}
