import { NextResponse } from "next/server";
import {
  createCardId,
  isValidDueDate,
  nextPosition,
  readBoard,
  writeBoard,
} from "@/lib/board";

type CreateCardBody = {
  title?: unknown;
  desc?: unknown;
  list?: unknown;
  due?: unknown;
};

export async function POST(request: Request) {
  let body: CreateCardBody;
  try {
    body = (await request.json()) as CreateCardBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const desc = body.desc === undefined ? "" : body.desc;
  const due = body.due === undefined || body.due === "" ? null : body.due;

  if (!title || typeof desc !== "string" || typeof body.list !== "string" || !isValidDueDate(due)) {
    return NextResponse.json({ error: "Card data is invalid" }, { status: 400 });
  }

  try {
    const board = readBoard();
    if (!board.lists.some((list) => list.id === body.list)) {
      return NextResponse.json({ error: "List does not exist" }, { status: 400 });
    }

    const timestamp = new Date().toISOString();
    const card = {
      id: createCardId(),
      title,
      desc,
      list: body.list,
      pos: nextPosition(board, body.list),
      due,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    board.cards.push(card);
    writeBoard(board);
    return NextResponse.json(card, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to create card" }, { status: 500 });
  }
}
