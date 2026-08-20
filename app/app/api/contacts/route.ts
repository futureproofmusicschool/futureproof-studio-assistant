import { NextResponse } from "next/server";
import { readContacts } from "@/lib/contacts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readContacts());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read contacts" },
      { status: 500 },
    );
  }
}
