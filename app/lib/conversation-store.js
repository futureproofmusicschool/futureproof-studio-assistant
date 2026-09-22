// The rolling conversation thread: one history shared by text chat and voice
// calls.
//
// Plain CommonJS on purpose. app/server.js `require`s this file directly (the
// WS relay persists voice turns) and Next bundles its own copy for the route
// handlers. That means TWO module instances with no shared memory, so this
// module holds NO in-memory state: every turn is a single appended JSONL line
// and the small state file is written atomically. Anything cached here would
// silently fork between the relay and the routes.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { defaultDataRoot } = require("./runtime/config.js");
const { atomicWrite, readJson, writeJson } = require("./runtime/files.js");

const DATA_ROOT = defaultDataRoot();
const CONVERSATION_DIR = path.join(DATA_ROOT, "conversation");
const THREAD_PATH = path.join(CONVERSATION_DIR, "thread.jsonl");
const STATE_PATH = path.join(CONVERSATION_DIR, "state.json");
const UPLOADS_DIR = path.join(CONVERSATION_DIR, "uploads");
const TRANSCRIPTS_DIR = path.join(CONVERSATION_DIR, "transcripts");

/** The UI keeps a generous tail; model context is selected separately by character budget. */
const DEFAULT_READ_LIMIT = 200;
const MODEL_HISTORY_CHAR_BUDGET = 64_000;
const SEED_CHAR_BUDGET = 32_000;
const HISTORY_OMISSION_MARKER = "\n\n[… middle omitted from model history …]\n\n";

function clipHistoryText(text, charBudget) {
  if (text.length <= charBudget) return text;
  if (charBudget <= HISTORY_OMISSION_MARKER.length + 2) return "";

  const available = charBudget - HISTORY_OMISSION_MARKER.length;
  const beginning = Math.ceil(available / 2);
  const ending = Math.floor(available / 2);
  return `${text.slice(0, beginning)}${HISTORY_OMISSION_MARKER}${text.slice(-ending)}`;
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function newTurnId() {
  return `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Normalize whatever a caller hands us into a storable turn. Unknown roles and
 * modes are coerced rather than rejected: losing a turn is worse than storing
 * an odd one.
 */
function normalizeTurn(turn) {
  const role = turn.role === "assistant" || turn.role === "tool" ? turn.role : "user";
  const mode = turn.mode === "voice" ? "voice" : "text";
  const text = typeof turn.text === "string" ? turn.text.trim() : "";

  return {
    id: typeof turn.id === "string" && turn.id ? turn.id : newTurnId(),
    role,
    mode,
    text,
    createdAt: Number.isFinite(turn.createdAt) ? turn.createdAt : Date.now(),
    ...(turn.attachment ? { attachment: turn.attachment } : {}),
  };
}

function appendTurns(turns) {
  const normalized = (Array.isArray(turns) ? turns : [turns])
    .map(normalizeTurn)
    .filter((turn) => turn.text || turn.attachment);
  if (normalized.length === 0) return [];

  ensureDir(CONVERSATION_DIR);
  fs.appendFileSync(THREAD_PATH, `${normalized.map((turn) => JSON.stringify(turn)).join("\n")}\n`, "utf8");
  return normalized;
}

function appendTurn(turn) {
  return appendTurns([turn])[0] ?? null;
}

/**
 * Read the tail of the thread. A half-written last line (server killed
 * mid-append) is skipped rather than throwing.
 */
function readTurns(options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : DEFAULT_READ_LIMIT;

  let raw;
  try {
    if (limit <= 0) raw = fs.readFileSync(THREAD_PATH, "utf8");
    else {
      const fd = fs.openSync(THREAD_PATH, "r");
      try {
        let position = fs.fstatSync(fd).size;
        const chunks = [];
        let lines = 0;
        while (position > 0 && lines <= limit + 1) {
          const size = Math.min(position, 64 * 1024);
          position -= size;
          const chunk = Buffer.alloc(size);
          fs.readSync(fd, chunk, 0, size, position);
          for (const byte of chunk) if (byte === 10) lines++;
          chunks.unshift(chunk);
        }
        raw = Buffer.concat(chunks).toString("utf8");
        if (position > 0) raw = raw.slice(raw.indexOf("\n") + 1);
      } finally { fs.closeSync(fd); }
    }
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const turns = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      turns.push(JSON.parse(line));
    } catch {
      // Torn line from an interrupted write. Skip it.
    }
  }

  return limit > 0 ? turns.slice(-limit) : turns;
}

/**
 * Keep the newest useful conversation context under a predictable payload
 * budget. Character budgeting is deliberately simple and model-independent;
 * it prevents a run of long turns or attachment extracts from making every
 * text request progressively slower. The newest turn is always retained so a
 * single large upload can still be answered.
 */
function selectModelTurns(turns, charBudget = MODEL_HISTORY_CHAR_BUDGET) {
  const selected = [];
  let used = 0;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role === "tool") continue;

    const cost =
      String(turn.text || "").length +
      String(turn.attachment?.summary || "").length +
      (turn.attachment ? String(turn.attachment.name || "").length + 32 : 0);

    if (selected.length > 0 && used + cost > charBudget) {
      const clipped = clipHistoryText(String(turn.text || ""), Math.max(0, charBudget - used));
      if (clipped) selected.unshift({ ...turn, text: clipped, attachment: undefined });
      break;
    }
    selected.unshift(turn);
    used += cost;
  }

  return selected;
}

function readState() {
  const state = readJson(STATE_PATH, {});
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Conversation state is invalid.");
  return state;
}

/** Write through a temp file so a crash never leaves a truncated state file. */
function patchState(partial) {
  const next = { ...readState(), ...partial };
  ensureDir(CONVERSATION_DIR);
  writeJson(STATE_PATH, next);
  return next;
}

/**
 * Overlap-merging concatenation for streamed transcription fragments. Gemini
 * repeats the tail of the previous fragment often enough that plain
 * concatenation stutters. Ported from Kadence's mergeTranscriptText.
 */
const { mergeTranscriptText } = require("./transcript-text.js");

/**
 * Prior thread turns to hand a brand new Live session, newest-first under a
 * character budget, in the Gemini `contents` shape. Tool turns are skipped
 * (they are chips, not conversation) and the result always starts with a user
 * turn, because Live rejects history that opens on a model turn.
 */
function selectSeedTurns(turns, charBudget = SEED_CHAR_BUDGET) {
  const selected = [];
  let used = 0;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role === "tool") continue;

    const text = String(turn.text || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (used + text.length > charBudget) {
      const clipped = clipHistoryText(text, Math.max(0, charBudget - used));
      if (clipped) {
        selected.unshift({ role: turn.role === "assistant" ? "model" : "user", parts: [{ text: clipped }] });
      }
      break;
    }

    used += text.length;
    selected.unshift({ role: turn.role === "assistant" ? "model" : "user", parts: [{ text }] });
  }

  if (selected.length > 0 && selected[0].role === "model") {
    selected.unshift({
      role: "user",
      parts: [{ text: "[CONVERSATION EVENT] Earlier in this conversation:" }],
    });
  }

  return selected;
}

/** Called only after a successful filing: the markdown holds the full record. */
function compactAfterFiling(keepCount = 400) {
  const all = readTurns({ limit: 0 });
  if (all.length <= keepCount) return all.length;

  ensureDir(CONVERSATION_DIR);
  const marker = readState().lastFiledTurnId;
  const completed = all.findIndex((turn) => turn.id === marker);
  if (completed < 0) return all.length;
  const keepFrom = Math.min(completed + 1, Math.max(0, all.length - keepCount));
  const kept = all.slice(keepFrom);
  atomicWrite(THREAD_PATH, `${kept.map((turn) => JSON.stringify(turn)).join("\n")}\n`);
  return kept.length;
}

module.exports = {
  DATA_ROOT,
  CONVERSATION_DIR,
  THREAD_PATH,
  STATE_PATH,
  UPLOADS_DIR,
  TRANSCRIPTS_DIR,
  MODEL_HISTORY_CHAR_BUDGET,
  SEED_CHAR_BUDGET,
  appendTurn,
  appendTurns,
  readTurns,
  selectModelTurns,
  readState,
  patchState,
  mergeTranscriptText,
  selectSeedTurns,
  compactAfterFiling,
  newTurnId,
};
