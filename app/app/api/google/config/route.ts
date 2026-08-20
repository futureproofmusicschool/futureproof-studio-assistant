import { NextResponse } from "next/server";
import {
  GOOGLE_SERVICES,
  GOOGLE_SERVICE_SCOPES,
  googleOAuthConfigStatus,
  writeGoogleOAuthClientConfig,
} from "@/lib/google/config";
import { getGoogleConnectionStatus } from "@/lib/google/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      ...googleOAuthConfigStatus(),
      services: GOOGLE_SERVICES.map((id) => ({ id, scopes: GOOGLE_SERVICE_SCOPES[id] })),
      environmentVariables: [
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "GOOGLE_OAUTH_REDIRECT_URI",
      ],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  let body: { clientId?: unknown; clientSecret?: unknown; json?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const connection = getGoogleConnectionStatus();
    if (connection.source === "environment") {
      return NextResponse.json(
        { error: "This OAuth client comes from environment variables. Change it there, then restart the app." },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (connection.connected) {
      return NextResponse.json(
        { error: "Disconnect Google before replacing its OAuth client." },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    // The response intentionally contains configuration status only. The saved
    // client secret is never echoed back into the renderer.
    return NextResponse.json(writeGoogleOAuthClientConfig(body), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the Google OAuth client." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
