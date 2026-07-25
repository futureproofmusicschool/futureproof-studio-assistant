import { NextResponse } from "next/server";
import { isValidContacts, readContacts, writeContacts } from "@/lib/contacts";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json(readContacts());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read contacts" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (!isValidContacts(value)) {
    return NextResponse.json({ error: "Contacts data is invalid" }, { status: 400 });
  }

  try {
    writeContacts(value);
    return NextResponse.json(value);
  } catch {
    return NextResponse.json({ error: "Unable to write contacts" }, { status: 500 });
  }
}
