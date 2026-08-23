import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { claimServerBeforePreparing } = require("../lib/server-startup.js") as {
  claimServerBeforePreparing: (
    server: http.Server,
    options: { port: number; host: string; prepare: () => Promise<void> },
  ) => Promise<void>;
};

function close(server: http.Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

test("a competing server cannot prepare after the port has been claimed", async () => {
  const first = http.createServer();
  let releaseFirst!: () => void;
  const firstCanFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const firstStartup = claimServerBeforePreparing(first, {
    port: 0,
    host: "127.0.0.1",
    prepare: () => firstCanFinish,
  });

  await new Promise<void>((resolve) => first.once("listening", resolve));
  const address = first.address();
  assert(address && typeof address === "object");

  const competitor = http.createServer();
  let competitorPrepared = false;
  await assert.rejects(
    claimServerBeforePreparing(competitor, {
      port: address.port,
      host: "127.0.0.1",
      prepare: async () => {
        competitorPrepared = true;
      },
    }),
    { code: "EADDRINUSE" },
  );
  assert.equal(competitorPrepared, false);

  releaseFirst();
  await firstStartup;
  await close(first);
});
