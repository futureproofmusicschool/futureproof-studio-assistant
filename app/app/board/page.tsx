import { BoardView } from "@/components/BoardView";
import { readBoard } from "@/lib/board";

export const dynamic = "force-dynamic";

export default function BoardPage() {
  return <BoardView initialBoard={readBoard()} />;
}
