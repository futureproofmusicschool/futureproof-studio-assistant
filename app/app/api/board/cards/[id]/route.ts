import { NextResponse } from "next/server";
import { isValidDueDate, nextPosition, readBoard, writeBoard } from "@/lib/board";

type UpdateCardBody = {
  title?: unknown;
  desc?: unknown;
  list?: unknown;
  pos?: unknown;
  due?: unknown;
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

const allowedKeys = new Set(["title", "desc", "list", "pos", "due"]);

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  let body: UpdateCardBody;
  try {
    body = (await request.json()) as UpdateCardBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Object.keys(body).some((key) => !allowedKeys.has(key)) ||
    (body.title !== undefined && (typeof body.title !== "string" || body.title.trim() === "")) ||
    (body.desc !== undefined && typeof body.desc !== "string") ||
    (body.list !== undefined && typeof body.list !== "string") ||
    (body.pos !== undefined && (typeof body.pos !== "number" || !Number.isFinite(body.pos))) ||
    (body.due !== undefined && body.due !== "" && !isValidDueDate(body.due))
  ) {
    return NextResponse.json({ error: "Card update is invalid" }, { status: 400 });
  }

  try {
    const board = readBoard();
    const card = board.cards.find((item) => item.id === id);
    if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

    if (body.list !== undefined && !board.lists.some((list) => list.id === body.list)) {
      return NextResponse.json({ error: "List does not exist" }, { status: 400 });
    }

    const movedToNewList = body.list !== undefined && body.list !== card.list;
    if (body.title !== undefined) card.title = body.title.trim();
    if (body.desc !== undefined) card.desc = body.desc;
    if (body.list !== undefined) card.list = body.list;
    if (body.pos !== undefined) {
      card.pos = body.pos;
    } else if (movedToNewList) {
      card.pos = nextPosition(board, card.list);
    }
    if (body.due !== undefined) card.due = body.due === "" ? null : body.due as string | null;
    card.updatedAt = new Date().toISOString();

    writeBoard(board);
    return NextResponse.json(card);
  } catch {
    return NextResponse.json({ error: "Unable to update card" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const board = readBoard();
    const cardIndex = board.cards.findIndex((card) => card.id === id);
    if (cardIndex === -1) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }

    const [deletedCard] = board.cards.splice(cardIndex, 1);
    writeBoard(board);
    return NextResponse.json(deletedCard);
  } catch {
    return NextResponse.json({ error: "Unable to delete card" }, { status: 500 });
  }
}
