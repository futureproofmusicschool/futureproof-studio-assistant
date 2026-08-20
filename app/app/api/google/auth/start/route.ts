import { NextResponse } from "next/server";
import { beginGoogleAuthorization } from "@/lib/google/auth";
import { parseGoogleServices } from "@/lib/google/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const services = parseGoogleServices(url.searchParams.get("services"));
    const started = beginGoogleAuthorization(services);

    if (url.searchParams.get("format") === "json") {
      return NextResponse.json(started, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    return NextResponse.redirect(started.authorizationUrl, 303);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start Google sign-in." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
