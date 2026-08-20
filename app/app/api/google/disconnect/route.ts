import { NextResponse } from "next/server";
import { disconnectGoogle, getGoogleConnectionStatus } from "@/lib/google/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await disconnectGoogle();
    return NextResponse.json(
      { ...result, status: getGoogleConnectionStatus() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not disconnect Google." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
