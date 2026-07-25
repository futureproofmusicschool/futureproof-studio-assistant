// Custom Next server for the studio assistant app.
//
// Why this exists: the Talk tab was designed to have the browser connect
// straight to Gemini Live with a short-lived ephemeral token. That API surface
// does not work for this Live model right now (POST /v1alpha/auth_tokens mints
// a token, but the Live socket rejects it: "API key not valid" as ?key= and
// "unregistered callers" as ?access_token=, and liveConnectConstraints is not a
// recognised field). So the socket is relayed here instead, which keeps the
// GEMINI_API_KEY on the server and keeps port 3017 the only server. Swap back
// to direct-with-token when Google ships working ephemeral tokens for Live.
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const next = require("next");
const { WebSocket, WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 3017);
const dev = process.env.NODE_ENV !== "production";
const ENV_PATH = path.join(__dirname, "..", ".env");
const GEMINI_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

function parseEnv(source) {
  const values = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }

  return values;
}

function loadApiKey() {
  try {
    return parseEnv(fs.readFileSync(ENV_PATH, "utf8")).GEMINI_API_KEY || "";
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return "";
  }
}

function relay(browser) {
  const apiKey = loadApiKey();

  if (!apiKey) {
    browser.send(JSON.stringify({ relayError: "GEMINI_API_KEY is missing from the repo .env file." }));
    browser.close(1011, "Missing API key");
    return;
  }

  const upstream = new WebSocket(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`);
  const pending = [];

  browser.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      // The client sends `setup` the moment its socket opens, which can beat
      // the upstream handshake. Hold those frames instead of dropping them.
      pending.push([data, isBinary]);
    }
  });

  browser.on("close", () => {
    if (upstream.readyState < WebSocket.CLOSING) upstream.close(1000, "Browser disconnected");
  });

  browser.on("error", (error) => {
    console.error("Talk browser socket error:", error.message);
  });

  upstream.on("open", () => {
    for (const [data, isBinary] of pending.splice(0)) upstream.send(data, { binary: isBinary });
  });

  // Gemini Live flags its JSON frames as binary; forward them untouched and let
  // the browser parse.
  upstream.on("message", (data, isBinary) => {
    if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary: isBinary });
  });

  upstream.on("error", (error) => {
    console.error("Gemini Live socket error:", error.message);
    if (browser.readyState === WebSocket.OPEN) {
      browser.send(JSON.stringify({ relayError: "The Gemini Live connection failed." }));
    }
  });

  upstream.on("close", (code, reason) => {
    if (browser.readyState === WebSocket.OPEN) {
      browser.close(code === 1000 ? 1000 : 1011, reason.toString() || "Gemini connection closed");
    }
  });
}

async function main() {
  const app = next({ dev, dir: __dirname });
  await app.prepare();
  const handle = app.getRequestHandler();

  const server = http.createServer((request, response) => {
    handle(request, response);
  });

  const talkSockets = new WebSocketServer({ noServer: true });
  talkSockets.on("connection", relay);

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url, "http://localhost").pathname;

    if (pathname === "/api/talk/ws") {
      talkSockets.handleUpgrade(request, socket, head, (ws) => {
        talkSockets.emit("connection", ws);
      });
      return;
    }

    // Everything else (Next's HMR socket in dev) stays with Next.
    if (dev) {
      app.getUpgradeHandler()(request, socket, head);
      return;
    }

    socket.destroy();
  });

  server.listen(PORT, () => {
    console.log(`The app is listening at http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
