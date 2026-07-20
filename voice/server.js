const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocket, WebSocketServer } = require("ws");

const PORT = 3015;
const VOICE_DIR = __dirname;
const PUBLIC_DIR = path.join(VOICE_DIR, "public");
const PROMPT_PATH = path.join(VOICE_DIR, "prompt.md");
const TRANSCRIPTS_DIR = path.join(VOICE_DIR, "transcripts");
const ENV_PATH = path.join(VOICE_DIR, "..", ".env");
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
    const env = parseEnv(fs.readFileSync(ENV_PATH, "utf8"));
    return env.GEMINI_API_KEY || "";
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return "";
  }
}

function addTranscriptFragment(turns, speaker, text) {
  if (typeof text !== "string" || text.length === 0) return;
  const current = turns[turns.length - 1];
  if (current && current.speaker === speaker) {
    current.text += text;
  } else {
    turns.push({ speaker, text });
  }
}

function captureTranscriptions(turns, message) {
  const content = message && message.serverContent;
  if (!content) return;
  addTranscriptFragment(turns, "Artist", content.inputTranscription?.text);
  addTranscriptFragment(turns, "Assistant", content.outputTranscription?.text);
}

function timestampForFilename(date) {
  const pad = (value) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${day}-${time}`;
}

function writeTranscript(turns, date = new Date()) {
  fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  const filename = `${timestampForFilename(date)}.md`;
  const body = turns
    .filter((turn) => turn.text.trim())
    .map((turn) => `**${turn.speaker}:** ${turn.text.trim()}`)
    .join("\n\n");
  const markdown = `# Voice session\n\nDate: ${date.toISOString()}\n${body ? `\n${body}\n` : ""}`;
  const outputPath = path.join(TRANSCRIPTS_DIR, filename);
  fs.writeFileSync(outputPath, markdown, "utf8");
  return outputPath;
}

function setupMessage() {
  const prompt = fs.readFileSync(PROMPT_PATH, "utf8").trim();
  return {
    setup: {
      model: "models/gemini-3.1-flash-live-preview",
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Algenib" },
          },
        },
      },
      systemInstruction: { parts: [{ text: prompt }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const relativePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(PUBLIC_DIR, relativePath);

  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end(
        error.code === "ENOENT" ? "Not found" : "Server error",
      );
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(data);
  });
}

function createServer() {
  const server = http.createServer(serveStatic);
  const browserSockets = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    browserSockets.handleUpgrade(request, socket, head, (ws) => {
      browserSockets.emit("connection", ws);
    });
  });

  browserSockets.on("connection", (browser) => {
    const turns = [];
    let saved = false;
    let upstream;

    const finish = () => {
      if (saved) return;
      saved = true;
      try {
        const outputPath = writeTranscript(turns);
        console.log(`Saved transcript: ${outputPath}`);
      } catch (error) {
        console.error("Could not save transcript:", error.message);
      }
    };

    const apiKey = loadApiKey();

    browser.on("close", () => {
      if (upstream && upstream.readyState < WebSocket.CLOSING) upstream.close(1000, "Browser disconnected");
      finish();
    });

    browser.on("error", (error) => {
      console.error("Browser WebSocket error:", error.message);
    });

    if (!apiKey) {
      browser.send(JSON.stringify({ relayError: "GEMINI_API_KEY is missing from the repo .env file." }));
      browser.close(1011, "Missing API key");
      return;
    }

    upstream = new WebSocket(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`);

    upstream.on("open", () => {
      try {
        upstream.send(JSON.stringify(setupMessage()));
      } catch (error) {
        browser.send(JSON.stringify({ relayError: error.message }));
        browser.close(1011, "Setup failed");
      }
    });

    upstream.on("message", (data, isBinary) => {
      // Gemini Live sends its JSON frames flagged as BINARY, so we must attempt
      // a parse regardless of isBinary. Gating on !isBinary (the old behavior)
      // meant transcripts were never captured and the file came out empty.
      try {
        captureTranscriptions(turns, JSON.parse(data.toString("utf8")));
      } catch (error) {
        // Non-JSON or partial frame; forward it untouched below.
      }
      if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary: isBinary });
    });

    upstream.on("error", (error) => {
      console.error("Gemini WebSocket error:", error.message);
      if (browser.readyState === WebSocket.OPEN) {
        browser.send(JSON.stringify({ relayError: "The Gemini Live connection failed." }));
      }
    });

    upstream.on("close", (code, reason) => {
      if (browser.readyState === WebSocket.OPEN) {
        browser.close(code === 1000 ? 1000 : 1011, reason.toString() || "Gemini connection closed");
      }
    });

    browser.on("message", (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    });

  });

  return server;
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`Voice server listening at http://localhost:${PORT}`);
  });
}

module.exports = {
  addTranscriptFragment,
  captureTranscriptions,
  createServer,
  parseEnv,
  setupMessage,
  writeTranscript,
};
