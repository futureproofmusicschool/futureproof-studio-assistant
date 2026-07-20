import { NextResponse } from "next/server";
import { readAssistantConfig } from "@/lib/config";
import { checkVoiceServer, prepareInterview } from "@/lib/interviews";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { template?: unknown; topic?: unknown };
    if (typeof body.template !== "string") {
      return NextResponse.json({ error: "Choose an interview purpose." }, { status: 400 });
    }
    if (body.topic !== undefined && typeof body.topic !== "string") {
      return NextResponse.json({ error: "The topic must be text." }, { status: 400 });
    }

    const config = readAssistantConfig();
    prepareInterview(body.template, config.name, body.topic);
    const voiceServerRunning = await checkVoiceServer();
    return NextResponse.json({ ok: true, voiceServerRunning });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare the interview.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
