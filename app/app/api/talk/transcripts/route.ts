import { NextResponse } from "next/server";
import { writeTranscript, type TalkTurn } from "@/lib/talk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isTurn(value: unknown): value is TalkTurn {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TalkTurn).speaker === "string" &&
    typeof (value as TalkTurn).text === "string"
  );
}

export async function POST(request: Request) {
  let body: { turns?: unknown };

  try {
    body = (await request.json()) as { turns?: unknown };
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!Array.isArray(body.turns) || !body.turns.every(isTurn)) {
    return NextResponse.json({ error: "turns must be an array of { speaker, text }." }, { status: 400 });
  }

  try {
    return NextResponse.json({ path: writeTranscript(body.turns) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the transcript." },
      { status: 500 },
    );
  }
}
