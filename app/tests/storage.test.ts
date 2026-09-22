import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWrite, readJson } from "../lib/runtime/files.js";

test("bounded conversation reads retain complete UTF-8 records and tolerate a torn final append", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-storage-test-"));
  process.env.STUDIO_ASSISTANT_DATA_DIR = root;
  try {
    const store = await import("../lib/conversation-store.js");
    store.appendTurns(Array.from({ length: 1000 }, (_, i) => ({ id: `turn-${i}`, role: "user", text: `café ${i} ` + "part ".repeat(100) })));
    fs.appendFileSync(store.THREAD_PATH, '{"id":"incomplete');
    const tail = store.readTurns();
    assert.equal(tail.length, 200);
    assert.equal(tail[0].id, "turn-800");
    assert.match(tail[199].text, /^café 999/);
    assert.equal(store.readTurns({ limit: 0 }).length, 1000);
    atomicWrite(store.STATE_PATH, "broken JSON");
    assert.throws(() => store.patchState({ lastFiledTurnId: "turn-999" }));
    assert.equal(fs.readFileSync(store.STATE_PATH, "utf8"), "broken JSON");
  } finally { fs.rmSync(root, { recursive: true, force: true }); delete process.env.STUDIO_ASSISTANT_DATA_DIR; }
});

test("atomic writes replace complete private files and do not hide corrupt JSON", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-atomic-test-"));
  try {
    const file = path.join(root, "state.json");
    assert.deepEqual(readJson(file, {}), {});
    atomicWrite(file, '{"value":1}'); atomicWrite(file, '{"value":2}');
    assert.deepEqual(readJson(file, {}), { value: 2 });
    assert.deepEqual(fs.readdirSync(root), ["state.json"]);
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    atomicWrite(file, "invalid");
    assert.throws(() => readJson(file, {}));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
