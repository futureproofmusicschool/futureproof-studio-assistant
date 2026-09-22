import assert from "node:assert/strict";
import test from "node:test";
import { SingleFlight } from "../lib/single-flight";
import { frameBuffer } from "../lib/frame-buffer";
import { consumeModelStream } from "../lib/model-stream";
import { readWithDeadline } from "../lib/request-deadline";
import { replyPrefix, matchesPrefix } from "../lib/ableton/replies";
import { clientFetch, invalidateClientReads } from "../lib/client-requests";

test("concurrent reads share work and failures can be retried", async () => {
  const flights = new SingleFlight<number>();
  let calls = 0;
  const work = async () => { calls++; return 42; };
  assert.deepEqual(await Promise.all([flights.run("read", work), flights.run("read", work)]), [42, 42]);
  assert.equal(calls, 1);
  await assert.rejects(flights.run("read", async () => { throw new Error("offline"); }));
  assert.equal(await flights.run("read", work), 42);
  assert.equal(calls, 2);
});

test("stream deltas coalesce and explicit flush preserves the final chunk", () => {
  let scheduled: (() => void) | undefined;
  const emitted: string[] = [];
  const buffer = frameBuffer((text) => emitted.push(text), (callback) => { scheduled = () => callback(0); return 1; }, () => { scheduled = undefined; });
  buffer.push("one"); buffer.push(" two");
  assert.deepEqual(emitted, []);
  scheduled!();
  buffer.push(" three"); buffer.flush(); buffer.flush();
  assert.deepEqual(emitted, ["one two", " three"]);
});

test("model stream handles split UTF-8, final unterminated frames, and tool order", async () => {
  const frames = [
    { candidates: [{ content: { parts: [{ text: "café " }] } }] },
    { candidates: [{ content: { parts: [{ functionCall: { name: "example", args: {} } }, { text: "done" }] } }] },
  ];
  const bytes = new TextEncoder().encode(frames.map((frame) => `data: ${JSON.stringify(frame)}`).join("\n\n"));
  const stream = new ReadableStream({ start(controller) { for (const byte of Array.from(bytes)) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const deltas: string[] = [];
  const parts = await consumeModelStream(new Response(stream), (event) => deltas.push(event.delta));
  assert.equal(deltas.join(""), "café done");
  assert.deepEqual(parts.map((part) => part.text ?? part.functionCall?.name), ["café ", "example", "done"]);
});

test("already emitted model text survives a subsequent provider error", async () => {
  const response = new Response('data: {"candidates":[{"content":{"parts":[{"text":"partial answer"}]}}]}\n\ndata: {"error":{"message":"interrupted"}}\n');
  const deltas: string[] = [];
  await assert.rejects(consumeModelStream(response, (event) => deltas.push(event.delta)), /interrupted/);
  assert.deepEqual(deltas, ["partial answer"]);
});

test("stalled reads invoke cancellation and reject", async () => {
  let cancelled = false;
  await assert.rejects(readWithDeadline(() => new Promise(() => {}), 5, () => { cancelled = true; }), /stopped making progress/);
  assert.equal(cancelled, true);
});

test("OSC replies cannot satisfy a different track or clip request", () => {
  assert.equal(matchesPrefix(replyPrefix("/live/clip/get/name", [2, 3]), [2, 4, "other"]), false);
  assert.equal(matchesPrefix(replyPrefix("/live/track/get/name", [2]), [2, "Track"]), true);
  assert.equal(matchesPrefix(["request-a"], ["request-b", "value"]), false);
});

test("client GET consumers receive independent bodies and mutations invalidate pending reads", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ calls }); };
  try {
    invalidateClientReads();
    const [a, b] = await Promise.all([clientFetch("/api/example"), clientFetch("/api/example")]);
    assert.deepEqual(await a.json(), await b.json());
    assert.equal(calls, 1);
    await clientFetch("/api/settings", { method: "PATCH" });
    await clientFetch("/api/example");
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; invalidateClientReads(); }
});
