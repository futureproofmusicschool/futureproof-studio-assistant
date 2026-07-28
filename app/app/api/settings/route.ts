import { NextResponse } from "next/server";
import { claudeCodeAvailable } from "@/lib/composer";
import { readAssistantConfig, writeAssistantConfig } from "@/lib/config";
import { readAnthropicApiKey, readGeminiApiKey, writeAnthropicApiKey, writeGeminiApiKey } from "@/lib/env";
import { listReferenceDocs } from "@/lib/reference";
import { DATA_ROOT } from "@/lib/paths";
import { readSettings, writeSettings, type ComposerBackend } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keys themselves never go to the browser; only whether one is saved.
async function state() {
  const assistant = readAssistantConfig();
  return {
    ...readSettings(),
    assistantName: assistant.name,
    userName: assistant.userName,
    hasGeminiKey: readGeminiApiKey().length > 0,
    hasAnthropicKey: readAnthropicApiKey().length > 0,
    hasClaudeCode: await claudeCodeAvailable(),
    referenceDocs: listReferenceDocs(),
    dataDirectory: DATA_ROOT,
  };
}

export async function GET() {
  return NextResponse.json(await state());
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      abletonHost?: string;
      geminiApiKey?: string;
      anthropicApiKey?: string;
      composerBackend?: string;
      assistantName?: string;
      userName?: string;
    };

    if (typeof body.geminiApiKey === "string") writeGeminiApiKey(body.geminiApiKey);
    if (typeof body.anthropicApiKey === "string") writeAnthropicApiKey(body.anthropicApiKey);

    if (typeof body.assistantName === "string" || typeof body.userName === "string") {
      writeAssistantConfig({
        ...(typeof body.assistantName === "string" ? { name: body.assistantName } : {}),
        ...(typeof body.userName === "string" ? { userName: body.userName } : {}),
      });
    }

    writeSettings({
      ...(typeof body.abletonHost === "string" ? { abletonHost: body.abletonHost } : {}),
      ...(typeof body.composerBackend === "string"
        ? { composer: { backend: body.composerBackend as ComposerBackend } }
        : {}),
    });

    return NextResponse.json(await state());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save settings." },
      { status: 400 },
    );
  }
}
