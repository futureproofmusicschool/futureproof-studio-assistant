import { NextResponse } from "next/server";
import { runStudioTool } from "@/lib/talk-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { name?: unknown; args?: unknown };

  try {
    body = (await request.json()) as { name?: unknown; args?: unknown };
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name : "";
  if (!name) {
    return NextResponse.json({ error: "A tool name is required." }, { status: 400 });
  }

  const args =
    typeof body.args === "object" && body.args !== null && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};

  try {
    // Tool failures come back as 200 with an `error` string: the model needs to
    // hear about them in the conversation, not as a dead HTTP request.
    return NextResponse.json(runStudioTool(name, args));
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : `Tool ${name} failed.`,
    });
  }
}
