import { NextResponse } from "next/server";
import { readAssistantConfig } from "@/lib/config";
import { buildSetupMessage, listTalkModes, OPEN_MODE } from "@/lib/talk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const config = readAssistantConfig();
    const modes = listTalkModes();
    const requested = new URL(request.url).searchParams.get("mode") ?? OPEN_MODE.id;
    const mode = modes.find((entry) => entry.id === requested);

    if (!mode) {
      return NextResponse.json({ error: `Unknown session mode "${requested}".` }, { status: 400 });
    }

    return NextResponse.json({
      setup: buildSetupMessage(mode.id, config.name),
      modes,
      mode: mode.id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not build the session config." },
      { status: 500 },
    );
  }
}
