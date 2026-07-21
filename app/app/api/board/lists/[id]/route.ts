import { NextResponse } from "next/server";
import {
  BoardListMutationError,
  deleteBoardList,
  readBoard,
  renameBoardList,
  writeBoard,
} from "@/lib/board";

type RenameListBody = {
  name?: unknown;
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  let body: RenameListBody;
  try {
    body = (await request.json()) as RenameListBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "List name is required" }, { status: 400 });

  try {
    const board = readBoard();
    renameBoardList(board, id, name);
    writeBoard(board);
    return NextResponse.json(board);
  } catch (error) {
    if (error instanceof BoardListMutationError && error.code === "not_found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to rename list" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const board = readBoard();
    const { deletedCards } = deleteBoardList(board, id);
    writeBoard(board);
    return NextResponse.json({ board, deletedCards });
  } catch (error) {
    if (error instanceof BoardListMutationError) {
      if (error.code === "not_found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (error.code === "last_list") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete list" },
      { status: 500 },
    );
  }
}
