import { NextResponse } from "next/server";
import { isValidBoard, readBoard, writeBoard } from "@/lib/board";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json(readBoard());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read board" },
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

  if (!isValidBoard(value)) {
    return NextResponse.json({ error: "Board data is invalid" }, { status: 400 });
  }

  try {
    writeBoard(value);
    return NextResponse.json(value);
  } catch {
    return NextResponse.json({ error: "Unable to write board" }, { status: 500 });
  }
}
