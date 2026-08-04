import { NextResponse } from "next/server";
import { readState, readTurns } from "@/lib/conversation-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the conversation window loads on boot: the tail of the rolling thread. */
export async function GET() {
  const state = readState();

  return NextResponse.json({
    turns: readTurns(),
    liveHandle: state.liveHandle ?? null,
    lastFiledDay: state.lastFiledDay ?? null,
  });
}
