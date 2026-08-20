import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * The desktop shell uses this marker before attaching to port 3017. A random
 * local HTTP service answering on the same port must never be mistaken for the
 * Studio Assistant renderer.
 */
export function GET() {
  return NextResponse.json(
    { app: "futureproof-studio-assistant", protocol: 1 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
