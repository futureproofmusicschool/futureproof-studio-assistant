import type { Board, BoardList } from "@/lib/board";

export class BoardListMutationError extends Error {
  constructor(
    message: string,
    public readonly code: "blank_name" | "not_found" | "last_list",
  ) {
    super(message);
    this.name = "BoardListMutationError";
  }
}

export function createBoardList(board: Board, rawName: string) {
  const name = rawName.trim();
  if (!name) throw new BoardListMutationError("List name is required", "blank_name");

  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const baseId = slug || "list";
  const existingIds = new Set(board.lists.map((list) => list.id));
  let id = slug;
  let suffix = 2;
  while (!id || existingIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  const list: BoardList = { id, name, kind: "workflow" };
  board.lists.push(list);
  return list;
}

export function renameBoardList(board: Board, id: string, rawName: string) {
  const name = rawName.trim();
  if (!name) throw new BoardListMutationError("List name is required", "blank_name");

  const list = board.lists.find((item) => item.id === id);
  if (!list) throw new BoardListMutationError("List not found", "not_found");
  list.name = name;
  return list;
}

export function deleteBoardList(board: Board, id: string) {
  const listIndex = board.lists.findIndex((list) => list.id === id);
  if (listIndex === -1) throw new BoardListMutationError("List not found", "not_found");
  if (board.lists.length === 1) {
    throw new BoardListMutationError("A board must keep at least one list", "last_list");
  }

  board.lists.splice(listIndex, 1);
  const previousCardCount = board.cards.length;
  board.cards = board.cards.filter((card) => card.list !== id);
  return { deletedCards: previousCardCount - board.cards.length };
}
