import { NextResponse } from "next/server";
import { discoverAbletonHosts } from "@/lib/ableton/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ hosts: await discoverAbletonHosts() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Discovery failed." },
      { status: 500 },
    );
  }
}
