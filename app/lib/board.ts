import crypto from "node:crypto";
import fs from "node:fs";
import { dataPath, ensureDataDirectory, repoPath } from "@/lib/paths";

export type BoardList = {
  id: string;
  name: string;
  kind: "workflow" | "backlog";
};

export type BoardCard = {
  id: string;
  title: string;
  desc: string;
  list: string;
  pos: number;
  due: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Board = {
  version: 1;
  lists: BoardList[];
  cards: BoardCard[];
};

export {
  BoardListMutationError,
  createBoardList,
  deleteBoardList,
  renameBoardList,
} from "@/lib/board-list-mutations";

const BOARD_PATH = dataPath("board", "board.json");
const TEMP_PATH = `${BOARD_PATH}.tmp`;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDueDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value.length === 0) return false;
  return !Number.isNaN(Date.parse(value));
}

export function isValidBoard(value: unknown): value is Board {
  if (!isRecord(value) || value.version !== 1) return false;
  if (!Array.isArray(value.lists) || !Array.isArray(value.cards)) return false;

  const listIds = new Set<string>();
  for (const list of value.lists) {
    if (
      !isRecord(list) ||
      typeof list.id !== "string" ||
      list.id.length === 0 ||
      typeof list.name !== "string" ||
      (list.kind !== "workflow" && list.kind !== "backlog") ||
      listIds.has(list.id)
    ) {
      return false;
    }
    listIds.add(list.id);
  }

  const cardIds = new Set<string>();
  for (const card of value.cards) {
    if (
      !isRecord(card) ||
      typeof card.id !== "string" ||
      cardIds.has(card.id) ||
      typeof card.title !== "string" ||
      typeof card.desc !== "string" ||
      typeof card.list !== "string" ||
      !listIds.has(card.list) ||
      typeof card.pos !== "number" ||
      !Number.isFinite(card.pos) ||
      !isDueDate(card.due) ||
      typeof card.createdAt !== "string" ||
      Number.isNaN(Date.parse(card.createdAt)) ||
      typeof card.updatedAt !== "string" ||
      Number.isNaN(Date.parse(card.updatedAt))
    ) {
      return false;
    }
    cardIds.add(card.id);
  }

  return true;
}

export function readBoard(): Board {
  let contents: string;
  try {
    contents = fs.readFileSync(BOARD_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    contents = fs.readFileSync(repoPath("examples", "board.json"), "utf8");
  }
  const value: unknown = JSON.parse(contents);
  if (!isValidBoard(value)) throw new Error("board/board.json is invalid");
  return value;
}

export function writeBoard(board: Board) {
  ensureDataDirectory("board");
  fs.writeFileSync(TEMP_PATH, `${JSON.stringify(board, null, 2)}\n`, "utf8");
  fs.renameSync(TEMP_PATH, BOARD_PATH);
}

export function createCardId() {
  const bytes = crypto.randomBytes(8);
  const suffix = Array.from(bytes, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
  return `c_${suffix}`;
}

export function nextPosition(board: Board, listId: string) {
  const positions = board.cards
    .filter((card) => card.list === listId)
    .map((card) => card.pos);
  return positions.length === 0 ? 1 : Math.max(...positions) + 1;
}

export function isValidDueDate(value: unknown) {
  return isDueDate(value);
}
