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

function defaultDataRoot() {
  const override = process.env.STUDIO_ASSISTANT_DATA_DIR?.trim();
  if (override) return path.resolve(override);

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Futureproof Studio Assistant");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "Futureproof Studio Assistant",
    );
  }
  return path.join(
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
    "futureproof-studio-assistant",
  );
}

const DATA_ROOT = defaultDataRoot();
const CONVERSATION_DIR = path.join(DATA_ROOT, "conversation");
const THREAD_PATH = path.join(CONVERSATION_DIR, "thread.jsonl");
const STATE_PATH = path.join(CONVERSATION_DIR, "state.json");
const UPLOADS_DIR = path.join(CONVERSATION_DIR, "uploads");
const TRANSCRIPTS_DIR = path.join(CONVERSATION_DIR, "transcripts");

/** How many turns the UI and the text model see. The file keeps everything until a filing compacts it. */
const DEFAULT_READ_LIMIT = 200;
const MODEL_HISTORY_TURNS = 60;
const SEED_CHAR_BUDGET = 4000;

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
    raw = fs.readFileSync(THREAD_PATH, "utf8");
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

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Write through a temp file so a crash never leaves a truncated state file. */
function patchState(partial) {
  const next = { ...readState(), ...partial };
  ensureDir(CONVERSATION_DIR);
  const temporary = `${STATE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, STATE_PATH);
  return next;
}

/**
 * Overlap-merging concatenation for streamed transcription fragments. Gemini
 * repeats the tail of the previous fragment often enough that plain
 * concatenation stutters. Ported from Kadence's mergeTranscriptText.
 */
function mergeTranscriptText(previous, next) {
  const before = previous || "";
  const addition = next || "";
  if (!before) return addition;
  if (!addition) return before;

  const maxOverlap = Math.min(before.length, addition.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (before.slice(-size) === addition.slice(0, size)) {
      return before + addition.slice(size);
    }
  }

  const needsSpace = !/\s$/.test(before) && !/^\s/.test(addition);
  return needsSpace ? `${before} ${addition}` : before + addition;
}

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
    if (used + text.length > charBudget) break;

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
  const kept = all.slice(-keepCount);
  const temporary = `${THREAD_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${kept.map((turn) => JSON.stringify(turn)).join("\n")}\n`, "utf8");
  fs.renameSync(temporary, THREAD_PATH);
  return kept.length;
}

module.exports = {
  DATA_ROOT,
  CONVERSATION_DIR,
  THREAD_PATH,
  STATE_PATH,
  UPLOADS_DIR,
  TRANSCRIPTS_DIR,
  MODEL_HISTORY_TURNS,
  SEED_CHAR_BUDGET,
  appendTurn,
  appendTurns,
  readTurns,
  readState,
  patchState,
  mergeTranscriptText,
  selectSeedTurns,
  compactAfterFiling,
  newTurnId,
};
