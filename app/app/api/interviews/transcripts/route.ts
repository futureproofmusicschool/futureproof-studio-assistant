import { NextResponse } from "next/server";
import { readAssistantConfig } from "@/lib/config";
import { listTranscripts } from "@/lib/interviews";

export const runtime = "nodejs";

export async function GET() {
  try {
    const config = readAssistantConfig();
    return NextResponse.json({ transcripts: listTranscripts(config.name) });
  } catch {
    return NextResponse.json({ error: "Could not list voice transcripts." }, { status: 500 });
  }
}
