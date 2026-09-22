import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("failed filing stops its cursor; retries and same-day filing preserve the record", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-filing-test-"));
  process.env.STUDIO_ASSISTANT_DATA_DIR = root;
  const originalFetch = globalThis.fetch;
  try {
    fs.writeFileSync(path.join(root, ".env"), "GEMINI_API_KEY=example-key\n");
    const store = await import("../lib/conversation-store.js");
    const { startFiling, dayOf } = await import("../lib/filing");
    const firstDay = new Date(2020, 0, 1, 12).getTime();
    store.appendTurns([{ id: "first", role: "user", text: "First passage", createdAt: firstDay }, { id: "second", role: "user", text: "Second day", createdAt: firstDay + 86400000 }]);
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("unavailable", { status: 503 }); };
    await assert.rejects(startFiling(false), /503/);
    assert.equal(store.readState().lastFiledTurnId, undefined);
    assert.equal(calls, 1);
    globalThis.fetch = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ episodic: { title: "Session", body: "A generic session note." }, semantic: [], workingSelf: null }) }] } }] });
    };
    const a = startFiling(false); const b = startFiling(false);
    assert.equal(a, b);
    await a;
    assert.equal(store.readState().lastFiledTurnId, "second");
    assert.equal(calls, 3);
    await startFiling(false);
    assert.equal(calls, 3);
    store.appendTurn({ id: "third", role: "user", text: "Later passage", createdAt: firstDay + 86400001 });
    await startFiling(false);
    const transcript = fs.readFileSync(path.join(root, "conversation", "transcripts", `${dayOf(firstDay + 86400000)}.md`), "utf8");
    assert.match(transcript, /Second day/); assert.match(transcript, /Later passage/);
    assert.equal(store.readState().lastFiledTurnId, "third");
    assert.equal(fs.readdirSync(path.join(root, "memory", "episodic")).length, 3);
    // Compaction must retain every unfiled turn, even beyond the display tail.
    store.appendTurns(Array.from({ length: 600 }, (_, index) => ({ id: `unfiled-${index}`, role: "user", text: `Message ${index}` })));
    store.compactAfterFiling(10);
    assert.equal(store.readTurns({ limit: 0 }).length, 600);
    assert.equal(store.readTurns({ limit: 10 })[0].id, "unfiled-590");
  } finally { globalThis.fetch = originalFetch; fs.rmSync(root, { recursive: true, force: true }); delete process.env.STUDIO_ASSISTANT_DATA_DIR; }
});
