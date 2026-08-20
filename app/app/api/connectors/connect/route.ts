import { NextResponse } from "next/server";
import {
  connectorInstallUrl,
  getGoogleConnectorStatus,
  type GoogleConnectorApp,
} from "@/lib/connectors/google-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isApp(value: unknown): value is GoogleConnectorApp {
  return value === "drive" || value === "gmail";
}
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { app?: unknown };
    if (!isApp(body.app)) {
      return NextResponse.json({ error: "Choose Google Drive or Gmail." }, { status: 400 });
    }
    const status = await getGoogleConnectorStatus({ forceRefresh: true });
    return NextResponse.json({ installUrl: connectorInstallUrl(status, body.app), status }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not open connector setup." },
      { status: 500 },
    );
  }
}
