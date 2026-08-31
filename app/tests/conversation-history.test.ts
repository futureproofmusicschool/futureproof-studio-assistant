import assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_HISTORY_CHAR_BUDGET,
  selectSeedTurns,
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

test("an oversized prior response is clipped instead of erasing the referent", () => {
  const selected = selectModelTurns(
    [turn("page", `page-start-${"x".repeat(200)}-page-end`, "assistant"), turn("save", "please save it")],
    100,
  );

  assert.deepEqual(selected.map((item) => item.id), ["page", "save"]);
  assert.match(selected[0].text, /^page-start-/);
  assert.match(selected[0].text, /-page-end$/);
  assert.match(selected[0].text, /middle omitted/);
});

test("a new Live session always receives recent context even when the newest turn is oversized", () => {
  const seeds = selectSeedTurns([turn("page", `page-start-${"x".repeat(200)}-page-end`, "assistant")], 100);

  assert.equal(seeds[0].role, "user");
  assert.equal(seeds[1].role, "model");
  assert.match(seeds[1].parts[0].text, /^page-start-/);
  assert.match(seeds[1].parts[0].text, /-page-end$/);
});
