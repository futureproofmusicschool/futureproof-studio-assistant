import { NextResponse } from "next/server";
import { createBoardList, readBoard, writeBoard } from "@/lib/board";

type CreateListBody = {
  name?: unknown;
};

export async function POST(request: Request) {
  let body: CreateListBody;
  try {
    body = (await request.json()) as CreateListBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "List name is required" }, { status: 400 });

  try {
    const board = readBoard();
    createBoardList(board, name);
    writeBoard(board);
    return NextResponse.json(board, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create list" },
      { status: 500 },
    );
  }
}
