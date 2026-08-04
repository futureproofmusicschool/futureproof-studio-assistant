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
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const next = require("next");
const { WebSocket, WebSocketServer } = require("ws");
// Next bundles its own copy of this module for the route handlers, so it holds
// no in-memory state: every write goes straight to disk.
const conversation = require("./lib/conversation-store.js");

const PORT = Number(process.env.PORT || 3017);
const dev = process.env.NODE_ENV !== "production";
const REPO_ROOT = path.join(__dirname, "..");
const DATA_ROOT = process.env.STUDIO_ASSISTANT_DATA_DIR?.trim()
  ? path.resolve(process.env.STUDIO_ASSISTANT_DATA_DIR.trim())
  : process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support", "Futureproof Studio Assistant")
    : process.platform === "win32"
      ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Futureproof Studio Assistant")
      : path.join(
          process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
          "futureproof-studio-assistant",
        );
const ENV_PATH = path.join(DATA_ROOT, ".env");
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

function safeGeminiDetail(value) {
  const raw = String(value || "")
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, "[redacted API key]")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw);
    const detail = parsed?.error?.message || parsed?.message || parsed?.error?.status;
    if (typeof detail === "string" && detail.trim()) return safeGeminiDetail(detail);
  } catch {
    // WebSocket close reasons are often plain text rather than JSON.
  }

  return raw.slice(0, 500);
}

function reportGeminiFailure(browser, message) {
  const safeMessage = safeGeminiDetail(message) || "Gemini Live closed the connection without an explanation.";
  console.error(`Gemini Live session rejected: ${safeMessage}`);
  if (browser.readyState === WebSocket.OPEN) {
    browser.send(JSON.stringify({ relayError: safeMessage }));
  }
}

/**
 * A voice call's turns, persisted here rather than in the browser.
 *
 * The relay sees every frame anyway, and it survives the tab closing
 * mid-sentence, so this is the one place that can promise the conversation is
 * on disk. Fragments arrive piecemeal and overlap, hence mergeTranscriptText.
 */
function createVoiceRecorder() {
  let pendingUserTyped = "";
  let pendingUserVoice = "";
  let pendingAssistantTranscript = "";
  let pendingAssistantModel = "";

  const flush = () => {
    const turns = [];

    if (pendingUserTyped.trim()) turns.push({ role: "user", mode: "text", text: pendingUserTyped });
    if (pendingUserVoice.trim()) turns.push({ role: "user", mode: "voice", text: pendingUserVoice });

    // Prefer the spoken transcription; the modelTurn text parts are a fallback
    // for the rare turn that carries text without transcription.
    const assistant = pendingAssistantTranscript.trim() || pendingAssistantModel.trim();
    if (assistant) turns.push({ role: "assistant", mode: "voice", text: assistant });

    pendingUserTyped = "";
    pendingUserVoice = "";
    pendingAssistantTranscript = "";
    pendingAssistantModel = "";

    if (turns.length > 0) {
      try {
        conversation.appendTurns(turns);
      } catch (error) {
        console.error("Could not persist voice turns:", error.message);
      }
    }
  };

  return {
    /** Frames the browser sends up. */
    fromBrowser(frame) {
      const typed = frame?.realtimeInput?.text;
      if (typeof typed === "string" && typed.trim()) {
        pendingUserTyped = conversation.mergeTranscriptText(pendingUserTyped, typed);
      }
      // clientContent is only ever seeding (prior thread turns replayed into a
      // fresh Live session). Persisting it would double the thread on every call.
      if (frame?.clientContent) {
        console.log(`Live seeding: ${frame.clientContent.turns?.length ?? 0} prior turns (not persisted)`);
      }
    },

    /** Frames Gemini sends down. */
    fromUpstream(frame) {
      const content = frame?.serverContent;
      if (!content) return;

      const heard = content.inputTranscription?.text;
      if (typeof heard === "string" && heard) {
        pendingUserVoice = conversation.mergeTranscriptText(pendingUserVoice, heard);
      }

      const spoken = content.outputTranscription?.text;
      if (typeof spoken === "string" && spoken) {
        pendingAssistantTranscript = conversation.mergeTranscriptText(pendingAssistantTranscript, spoken);
      }

      for (const part of content.modelTurn?.parts ?? []) {
        if (typeof part.text === "string" && part.text) {
          pendingAssistantModel = conversation.mergeTranscriptText(pendingAssistantModel, part.text);
        }
      }

      if (content.turnComplete) flush();
    },

    /** Whatever was mid-sentence when the socket died still belongs on disk. */
    flush,
  };
}

function parseFrame(data) {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

function relay(browser) {
  const apiKey = loadApiKey();

  if (!apiKey) {
    browser.send(JSON.stringify({ relayError: "GEMINI_API_KEY is missing from the personal data .env file." }));
    browser.close(1011, "Missing API key");
    return;
  }

  const upstream = new WebSocket(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`);
  const pending = [];
  const recorder = createVoiceRecorder();

  browser.on("message", (data, isBinary) => {
    const frame = parseFrame(data);
    // Audio chunks are the overwhelming majority of frames; skip parsing them.
    if (frame && !frame.realtimeInput?.audio) recorder.fromBrowser(frame);

    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      // The client sends `setup` the moment its socket opens, which can beat
      // the upstream handshake. Hold those frames instead of dropping them.
      pending.push([data, isBinary]);
    }
  });

  browser.on("close", () => {
    recorder.flush();
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
    const frame = parseFrame(data);
    if (frame) recorder.fromUpstream(frame);
    if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary: isBinary });
  });

  upstream.on("error", (error) => {
    reportGeminiFailure(browser, `Gemini Live connection failed: ${error.message}`);
  });

  upstream.on("close", (code, reason) => {
    recorder.flush();
    const detail = safeGeminiDetail(reason.toString());

    // The client classifies closes to decide whether to reconnect (an expired
    // resumption handle is recoverable, a bad argument is not), so the real
    // code and reason have to survive the hop. Close reasons are capped at 123
    // bytes on the wire and the words that matter ("session expired", "invalid
    // argument", "too large") come first, so truncate from the end.
    if (code !== 1000 && !detail) {
      reportGeminiFailure(browser, `Gemini rejected the session with WebSocket code ${code} and no explanation.`);
    } else if (code !== 1000) {
      console.error(`Gemini Live closed (code ${code}): ${detail}`);
    }

    if (browser.readyState === WebSocket.OPEN) {
      const safeCode = code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006 ? code : 1011;
      browser.close(safeCode, (detail || "Gemini session ended").slice(0, 110));
    }
  });
}

/**
 * The conversation has no session end any more, so nothing else would ever ask
 * the bookkeeper to read it. Check on boot and hourly; the route is idempotent
 * and only files days that are already over, so a quiet check costs nothing.
 */
function scheduleFiling() {
  const runFiling = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/conversation/file?auto=1`, { method: "POST" });
      const body = await response.json();
      if (body.filed?.length) console.log(`Filed into memory: ${body.filed.join(", ")}`);
    } catch (error) {
      console.error("Could not run the daily filing:", error.message);
    }
  };

  // A little after boot, so the first request is not competing with startup.
  setTimeout(runFiling, 30_000).unref?.();
  setInterval(runFiling, 60 * 60 * 1000).unref?.();
}

async function main() {
  execFileSync(process.execPath, [path.join(REPO_ROOT, "scripts", "init-data.mjs")], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
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
    scheduleFiling();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
