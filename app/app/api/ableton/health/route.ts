import { NextResponse } from "next/server";
import { currentAbletonHost, probeHost } from "@/lib/ableton/bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const host = currentAbletonHost();
  const probe = await probeHost(host);
  return NextResponse.json({ host, ...probe });
}
