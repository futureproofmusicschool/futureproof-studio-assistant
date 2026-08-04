import { NextResponse } from "next/server";
import { patchState } from "@/lib/conversation-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Live session-resumption handle, kept on disk so a reload mid-call can
 * rejoin the same Gemini session instead of starting over. An empty string
 * clears it (deliberate hangup, or Gemini said the session is not resumable).
 */
export async function POST(request: Request) {
  let body: { handle?: unknown };
  try {
    body = (await request.json()) as { handle?: unknown };
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const handle = typeof body.handle === "string" && body.handle.trim() ? body.handle.trim() : null;
  patchState({ liveHandle: handle, liveHandleUpdatedAt: Date.now() });

  return NextResponse.json({ liveHandle: handle });
}
