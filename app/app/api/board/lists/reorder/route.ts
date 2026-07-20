import { NextResponse } from "next/server";
import { readBoard, writeBoard } from "@/lib/board";

type ReorderListsBody = {
  order?: unknown;
};

export async function POST(request: Request) {
  let body: ReorderListsBody;
  try {
    body = (await request.json()) as ReorderListsBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  try {
    const board = readBoard();
    const order = body?.order;
    const existingIds = new Set(board.lists.map((list) => list.id));

    if (
      !Array.isArray(order) ||
      order.length !== board.lists.length ||
      order.some((id) => typeof id !== "string") ||
      new Set(order).size !== order.length ||
      order.some((id) => !existingIds.has(id))
    ) {
      return NextResponse.json(
        { error: "Order must contain every list id exactly once" },
        { status: 400 },
      );
    }

    const listsById = new Map(board.lists.map((list) => [list.id, list]));
    board.lists = order.map((id) => listsById.get(id)!);
    writeBoard(board);
    return NextResponse.json(board);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to reorder lists" },
      { status: 500 },
    );
  }
}
