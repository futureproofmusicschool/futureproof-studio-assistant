import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { probeServer } from "../../desktop/server-probe.mjs";

function listen(server: http.Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      resolve(address.port);
    });
  });
}

function close(server: http.Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

test("a health-check timeout is treated as occupied", async () => {
  const server = http.createServer(() => {});
  const port = await listen(server);

  assert.equal(await probeServer({ port, timeoutMs: 20 }), "occupied");
  await close(server);
});

test("only an explicit connection refusal is treated as empty", async () => {
  const server = http.createServer();
  const port = await listen(server);
  await close(server);

  assert.equal(await probeServer({ port, timeoutMs: 100 }), "empty");
});
