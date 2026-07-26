import { NextResponse } from "next/server";
import { readGeminiApiKey, writeGeminiApiKey } from "@/lib/env";
import { readSettings, writeSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The key itself never goes to the browser; only whether one is saved.
export async function GET() {
  return NextResponse.json({ ...readSettings(), hasGeminiKey: readGeminiApiKey().length > 0 });
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { abletonHost?: string; geminiApiKey?: string };
    if (typeof body.geminiApiKey === "string") writeGeminiApiKey(body.geminiApiKey);
    const update = typeof body.abletonHost === "string" ? { abletonHost: body.abletonHost } : {};
    return NextResponse.json({ ...writeSettings(update), hasGeminiKey: readGeminiApiKey().length > 0 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save settings." },
      { status: 400 },
    );
  }
}
