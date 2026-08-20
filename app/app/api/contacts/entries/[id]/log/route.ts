import { NextResponse } from "next/server";
import { appendContactLog, isValidContactLogAppend, updateContact } from "@/lib/contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (!isValidContactLogAppend(body)) {
    return NextResponse.json({ error: "Contact log entry is invalid" }, { status: 400 });
  }

  try {
    const entry = { date: body.date, channel: body.channel, summary: body.summary };
    if (!(await appendContactLog(id, entry, body.operationId))) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    // The log entry is already durable if this secondary convenience field
    // fails; critically, adding history never clears or rewrites older rows.
    try {
      const contact = await updateContact(id, { lastContact: entry.date });
      return NextResponse.json({ logged: true, contact });
    } catch (error) {
      return NextResponse.json({
        logged: true,
        contact: null,
        warning: `History was saved, but Last contact was not updated: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to append contact history" },
      { status: 500 },
    );
  }
}
