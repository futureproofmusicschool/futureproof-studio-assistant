import assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_HISTORY_CHAR_BUDGET,
  selectModelTurns,
} from "../lib/conversation-store.js";

function turn(id: string, text: string, role: "user" | "assistant" | "tool" = "user") {
  return {
    id,
    role,
    mode: "text" as const,
    text,
    createdAt: 0,
  };
}

test("text model history uses a character budget instead of a turn count", () => {
  const turns = [
    turn("old", "a".repeat(8)),
    turn("middle", "b".repeat(8), "assistant"),
    turn("tool", "ignored", "tool"),
    turn("new", "c".repeat(8)),
  ];

  assert.deepEqual(
    selectModelTurns(turns, 16).map((item) => item.id),
    ["middle", "new"],
  );
});

test("the newest turn survives even when it exceeds the model history budget", () => {
  const newest = turn("new", "x".repeat(MODEL_HISTORY_CHAR_BUDGET + 1));
  assert.deepEqual(selectModelTurns([turn("old", "old"), newest]), [newest]);
});

test("attachment summaries count toward the model history budget", () => {
  const withAttachment = {
    ...turn("attachment", "question"),
    attachment: {
      kind: "text" as const,
      name: "notes.txt",
      mimeType: "text/plain",
      path: "conversation/uploads/notes.txt",
      size: 100,
      summary: "s".repeat(20),
    },
  };

  assert.deepEqual(
    selectModelTurns([turn("old", "old"), withAttachment], 10).map((item) => item.id),
    ["attachment"],
  );
});
