import { NextResponse } from "next/server";
import { getGoogleConnectorStatus } from "@/lib/connectors/google-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getGoogleConnectorStatus();
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not inspect connector capabilities." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
