import { NextResponse } from "next/server";
import { readAssistantConfig } from "@/lib/config";
import { readState, readTurns, selectSeedTurns } from "@/lib/conversation-store";
import { buildSetupMessage, listTalkModes, OPEN_MODE } from "@/lib/talk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything a call needs to open, with the resumption handle and the history
 * seeds returned separately from the setup. The client splices them in per
 * attempt, because the reconnect ladder needs to retry without the handle
 * (expired) or without the seeds (resuming) and must not refetch to do it.
 */
export async function GET(request: Request) {
  try {
    const config = readAssistantConfig();
    const modes = listTalkModes();
    const params = new URL(request.url).searchParams;
    const requested = params.get("mode") ?? OPEN_MODE.id;
    const minimal = params.get("minimal") === "1";
    const mode = modes.find((entry) => entry.id === requested);

    if (!mode) {
      return NextResponse.json({ error: `Unknown session mode "${requested}".` }, { status: 400 });
    }

    return NextResponse.json({
      setup: await buildSetupMessage(mode.id, config.name, minimal),
      handle: readState().liveHandle ?? null,
      seedTurns: minimal ? [] : selectSeedTurns(readTurns()),
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
