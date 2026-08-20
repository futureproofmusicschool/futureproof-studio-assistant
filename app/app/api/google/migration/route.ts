import { NextResponse } from "next/server";
import { getGoogleMigrationStatus, importLegacyGoogleData } from "@/lib/google/migration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getGoogleMigrationStatus(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not inspect legacy data." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST() {
  try {
    const run = await importLegacyGoogleData();
    return NextResponse.json(
      { ...(await getGoogleMigrationStatus()), lastRun: run },
      { status: run.complete ? 200 : 207, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not import local data." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
