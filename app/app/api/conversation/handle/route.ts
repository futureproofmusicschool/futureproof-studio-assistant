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
  let body: { handle?: unknown; operationNamespace?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const handle = typeof body.handle === "string" && body.handle.trim() ? body.handle.trim() : null;
  const operationNamespace =
    typeof body.operationNamespace === "string" && body.operationNamespace.trim()
      ? body.operationNamespace.trim().slice(0, 200)
      : null;
  patchState({
    liveHandle: handle,
    liveHandleUpdatedAt: Date.now(),
    liveToolOperationNamespace: operationNamespace,
  });

  return NextResponse.json({ liveHandle: handle, liveToolOperationNamespace: operationNamespace });
}
