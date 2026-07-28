import { NextResponse } from "next/server";
import { fileTranscript } from "@/lib/bookkeeping";
import { writeTranscript, type TalkTurn } from "@/lib/talk";

/**
 * How long the response waits for Gemini Flash to file the session into memory
 * before answering honestly with "still filing". The filing itself keeps going
 * either way; this only bounds how long ending a session feels slow.
 */
const FILING_WAIT_MS = 12_000;

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

  let savedPath: string | null;
  try {
    savedPath = writeTranscript(body.turns);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the transcript." },
      { status: 500 },
    );
  }

  if (!savedPath) return NextResponse.json({ path: null, filed: false, filing: false });

  // Filing must never cost the artist the transcript that is already on disk.
  const filing = fileTranscript(savedPath).catch((error: unknown) => {
    console.error(`[bookkeeping] could not file ${savedPath}:`, error);
    return null;
  });

  const timeout = new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), FILING_WAIT_MS));
  const outcome = await Promise.race([filing, timeout]);

  if (outcome === "pending") return NextResponse.json({ path: savedPath, filed: false, filing: true });
  return NextResponse.json({ path: savedPath, filed: outcome !== null, filing: false });
}
