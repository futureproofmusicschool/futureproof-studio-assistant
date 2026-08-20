import { NextResponse } from "next/server";
import { ensureOutreachSpreadsheet, ensureStudioFolder } from "@/lib/google/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [folder, outreach] = await Promise.all([
      ensureStudioFolder(),
      ensureOutreachSpreadsheet(),
    ]);
    return NextResponse.json(
      { folder, outreach },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not open the Google workspace." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
