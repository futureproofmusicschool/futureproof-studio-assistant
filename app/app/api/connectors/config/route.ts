import { NextResponse } from "next/server";
import {
  clearGoogleConnectorStatusCache,
  getGoogleConnectorStatus,
} from "@/lib/connectors/google-runtime";
import { isConnectorHost, writeSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { selectedHost?: unknown };
    if (!isConnectorHost(body.selectedHost)) {
      return NextResponse.json({ error: "Choose Automatic, Codex, Claude Code, or Direct Google." }, { status: 400 });
    }
    writeSettings({ connectors: { host: body.selectedHost } });
    clearGoogleConnectorStatusCache();
    return NextResponse.json(await getGoogleConnectorStatus({ forceRefresh: true }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not change the connector host." },
      { status: 500 },
    );
  }
}
