import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { readAnthropicApiKey, readGeminiApiKey } from "@/lib/env";
import {
  CLAUDE_EFFORT,
  CLAUDE_FALLBACK_BETA,
  CLAUDE_FALLBACK_MODEL,
  COMPOSER_CLAUDE_MODEL,
  COMPOSER_GEMINI_MODEL,
} from "@/lib/models";
import { repoPath } from "@/lib/paths";
import { readSettings, type ComposerBackend } from "@/lib/settings";

/**
 * The composer seam: one function, three interchangeable brains.
 *
 * The voice agent (Gemini Live) gathers the brief in conversation; this module
 * writes the actual part; the Ableton tools put it into Live. Keeping the
 * writer separate from the conversation means we can A/B a different model on
 * the same brief by flipping one setting, which is the whole point: no
 * published benchmark covers "read this articulation doc and play like a
 * human", so the artist's ears decide.
 */

export type ComposedNote = {
  pitch: number;
  start_beats: number;
  duration_beats: number;
  velocity: number;
};

export type ComposeRequest = {
  brief: string;
  lengthBeats: number;
  tempo: number;
  timeSignature: string;
  /** Name of a doc in instruments/ (without .md). Its full text goes into the prompt. */
  instrument?: string;
  /** Name of a doc in styles/ (without .md). Its full text goes into the prompt. */
  style?: string;
  /** Notes already in the clip, when the artist is asking for a revision. */
  existingNotes?: ComposedNote[];
};

export type ComposeResult = {
  notes: ComposedNote[];
  explanation: string;
  backend: ComposerBackend;
  model: string;
};

const INSTRUMENTS_DIR = repoPath("instruments");
const STYLES_DIR = repoPath("styles");
const MAX_NOTES = 1000;
const MAX_INSTRUMENT_DOC_BYTES = 120 * 1024;
const CLAUDE_CODE_TIMEOUT_MS = 240_000;

/** Same shape as edit_live_clip_notes takes, so composed notes need no translation. */
const NOTE_JSON_SCHEMA = {
  type: "object",
  properties: {
    notes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pitch: { type: "integer", description: "MIDI pitch 0-127. Middle C is 60 (C3 in Ableton)." },
          start_beats: { type: "number", description: "Start position in beats from the clip start." },
          duration_beats: { type: "number", description: "Length in beats. Must be greater than 0." },
          velocity: { type: "integer", description: "1-127." },
        },
        required: ["pitch", "start_beats", "duration_beats", "velocity"],
        additionalProperties: false,
      },
    },
    explanation: {
      type: "string",
      description: "One or two spoken sentences about what you wrote and why. No markdown.",
    },
  },
  required: ["notes", "explanation"],
  additionalProperties: false,
} as const;

/**
 * Gemini's responseSchema is an OpenAPI subset that rejects
 * `additionalProperties` outright (400), while Anthropic's structured outputs
 * require it. Same contract, one dialect difference.
 */
function forGemini(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(forGemini);
  if (typeof schema !== "object" || schema === null) return schema;
  return Object.fromEntries(
    Object.entries(schema as Record<string, unknown>)
      .filter(([key]) => key !== "additionalProperties")
      .map(([key, value]) => [key, forGemini(value)]),
  );
}

// ---------------------------------------------------------------------------
// Instrument and style docs
//
// Two folders, two different questions. instruments/ says which MIDI note makes
// which sound in a particular sample library; styles/ says what a real player
// would actually play. Neither is derivable from the other, so a part usually
// wants both.
// ---------------------------------------------------------------------------

function listDocs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
      .map((entry) => entry.name.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

export function listInstruments(): string[] {
  return listDocs(INSTRUMENTS_DIR);
}

export function listStyles(): string[] {
  return listDocs(STYLES_DIR);
}

/** Reads <dir>/<name>.md. Refuses anything that isn't a plain name in that directory. */
function readDoc(dir: string, kind: string, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(name)) {
    throw new Error(`"${name}" is not a valid ${kind} name.`);
  }

  const file = path.join(dir, `${name}.md`);
  if (!fs.existsSync(file)) {
    const known = listDocs(dir);
    throw new Error(
      known.length
        ? `No ${kind} doc named "${name}". Available: ${known.join(", ")}.`
        : `No ${kind} doc named "${name}". The ${path.basename(dir)}/ folder is empty.`,
    );
  }

  const contents = fs.readFileSync(file, "utf8");
  return contents.length > MAX_INSTRUMENT_DOC_BYTES ? contents.slice(0, MAX_INSTRUMENT_DOC_BYTES) : contents;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildPrompt(request: ComposeRequest): string {
  const sections: string[] = [];

  sections.push(
    [
      "You are a session player writing MIDI for a working producer, not a grid editor.",
      "You are writing a performance: a human hand, a real instrument, a room. Timing sits slightly off the grid where a player's would. Velocities move constantly, because a player never hits twice the same. Phrases breathe: they build, they leave space, they resolve.",
      "Never output a mechanically quantised, single-velocity pattern. That is the one failure mode that makes this useless.",
    ].join(" "),
  );

  if (request.style) {
    sections.push(
      [
        `## The style: ${request.style}`,
        "",
        "This is how the instrument is actually played, by the people whose tradition it comes from. Treat it as the musical authority for this part: its stroke vocabulary, cycle lengths, accent placement, phrasing rules, and tempo ranges override any generic instinct you have about percussion. Where it names concrete patterns, either play one or build from one; do not invent a groove that ignores it. Where it says a player never does something, never do it.",
        "",
        readDoc(STYLES_DIR, "style", request.style),
      ].join("\n"),
    );
  }

  if (request.instrument) {
    sections.push(
      [
        `## The instrument: ${request.instrument}`,
        "",
        "This is the documentation for the instrument you are writing for. Read it carefully. Keyswitches and articulation triggers are ordinary MIDI notes at the pitches documented below: place them exactly where the documentation says they belong, and use them to shape the performance.",
        "",
        readDoc(INSTRUMENTS_DIR, "instrument", request.instrument),
      ].join("\n"),
    );
  }

  if (request.style && request.instrument) {
    sections.push(
      [
        "## Joining the two",
        "The style doc names strokes; the instrument doc names MIDI pitches. Your job is to map one onto the other: for each stroke the style calls for, pick the pitch whose documented sound matches it, and say which mapping you chose in your explanation so the artist can correct you. If the instrument cannot produce a stroke the style needs, substitute the nearest one it has rather than dropping the phrase.",
      ].join("\n"),
    );
  }

  sections.push(
    [
      "## The session",
      `Tempo: ${request.tempo} BPM`,
      `Time signature: ${request.timeSignature}`,
      `Clip length: ${request.lengthBeats} beats`,
      "Beat 0 is the start of the clip. Nothing may start before beat 0 or extend past the clip length.",
    ].join("\n"),
  );

  if (request.existingNotes?.length) {
    sections.push(
      [
        "## What is already in the clip",
        "You are revising this. Return the COMPLETE part you want in the clip, not just the changes.",
        "```json",
        JSON.stringify(request.existingNotes.slice(0, 400)),
        "```",
      ].join("\n"),
    );
  }

  sections.push(["## What the artist asked for", request.brief].join("\n"));

  sections.push(
    [
      "## Output",
      "Return JSON only. No prose outside it, no markdown fence, no commentary.",
      'Shape: {"notes": [{"pitch": 0-127, "start_beats": number, "duration_beats": number > 0, "velocity": 1-127}], "explanation": "string"}',
      "Ableton's convention: middle C is C3 = MIDI 60.",
      "The explanation is spoken out loud to the artist, so keep it to a sentence or two of plain speech.",
    ].join("\n"),
  );

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Marks the one failure worth retrying: the model answered, but not usably. */
class UnusableAnswer extends Error {}

function clampNotes(raw: unknown, lengthBeats: number): ComposedNote[] {
  if (!Array.isArray(raw)) throw new UnusableAnswer("The composer returned no notes array.");

  const notes: ComposedNote[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const note = entry as Record<string, unknown>;

    const pitch = Math.round(Number(note.pitch));
    const start = Number(note.start_beats);
    const duration = Number(note.duration_beats);
    if (!Number.isFinite(pitch) || pitch < 0 || pitch > 127) continue;
    if (!Number.isFinite(start) || start < 0 || start >= lengthBeats) continue;
    if (!Number.isFinite(duration) || duration <= 0) continue;

    const velocity = Number.isFinite(Number(note.velocity))
      ? Math.min(127, Math.max(1, Math.round(Number(note.velocity))))
      : 100;

    notes.push({
      pitch,
      start_beats: start,
      // Keyswitches are often written as very short notes; keep them, just don't
      // let anything spill past the clip.
      duration_beats: Math.min(duration, Math.max(0.01, lengthBeats - start)),
      velocity,
    });
  }

  if (notes.length === 0) throw new UnusableAnswer("The composer returned no usable notes.");
  notes.sort((a, b) => a.start_beats - b.start_beats || a.pitch - b.pitch);
  return notes.slice(0, MAX_NOTES);
}

function parsePayload(text: string, lengthBeats: number): { notes: ComposedNote[]; explanation: string } {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  // Models occasionally wrap the object in a sentence; take the outermost braces.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) throw new UnusableAnswer(`Expected JSON, got: ${trimmed.slice(0, 200)}`);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch (error) {
    throw new UnusableAnswer(`That was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    notes: clampNotes(parsed.notes, lengthBeats),
    explanation: typeof parsed.explanation === "string" ? parsed.explanation.trim() : "",
  };
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

async function composeWithGemini(prompt: string, lengthBeats: number) {
  const key = readGeminiApiKey();
  if (!key) throw new Error("No Gemini API key is saved. Add one in Settings.");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${COMPOSER_GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: forGemini(NOTE_JSON_SCHEMA),
          maxOutputTokens: 32000,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini refused the request (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }

  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error(`Gemini returned nothing (finish reason: ${body.candidates?.[0]?.finishReason}).`);

  return { ...parsePayload(text, lengthBeats), model: COMPOSER_GEMINI_MODEL };
}

async function composeWithAnthropicApi(prompt: string, lengthBeats: number) {
  const apiKey = readAnthropicApiKey();
  if (!apiKey) throw new Error("No Anthropic API key is saved. Add one in Settings under Composer.");

  const client = new Anthropic({ apiKey });
  // Fable's thinking is always on and cannot be configured; depth comes from
  // effort. Fallbacks are opt-in: without them a safety decline just stops.
  const stream = client.beta.messages.stream({
    model: COMPOSER_CLAUDE_MODEL,
    max_tokens: 32000,
    betas: [CLAUDE_FALLBACK_BETA],
    fallbacks: [{ model: CLAUDE_FALLBACK_MODEL }],
    output_config: {
      effort: CLAUDE_EFFORT,
      format: { type: "json_schema", schema: NOTE_JSON_SCHEMA },
    },
    messages: [{ role: "user", content: prompt }],
  });

  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new Error("Claude declined to write that part (safety classifiers). Try rewording the brief.");
  }

  const text = message.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!text) throw new Error(`Claude returned no text (stop reason: ${message.stop_reason}).`);

  return { ...parsePayload(text, lengthBeats), model: message.model };
}

const run = promisify(execFile);

/** Whether the `claude` CLI is on PATH. Used to warn before the backend is picked. */
export async function claudeCodeAvailable(): Promise<boolean> {
  try {
    await run("claude", ["--version"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Spawns the CLI with the prompt on stdin (it can be far past ARG_MAX with an instrument doc attached). */
function runClaudeCli(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // cwd is a temp dir so the CLI does not pick up this repo's CLAUDE.md and
    // start behaving like the studio assistant instead of a session player.
    const child = spawn(
      "claude",
      [
        "-p",
        "--output-format",
        "json",
        "--model",
        COMPOSER_CLAUDE_MODEL,
        "--effort",
        CLAUDE_EFFORT,
        "--tools",
        "",
        "--json-schema",
        JSON.stringify(NOTE_JSON_SCHEMA),
      ],
      { cwd: os.tmpdir(), stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error: Error | null, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value ?? "");
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`The claude CLI timed out after ${CLAUDE_CODE_TIMEOUT_MS / 1000}s.`));
    }, CLAUDE_CODE_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) =>
      finish(new Error(`Could not run the claude CLI: ${error.message}. Is it installed and signed in?`)),
    );
    child.on("close", (code) => {
      if (code === 0 && stdout.trim()) return finish(null, stdout);
      finish(new Error(`The claude CLI failed (exit ${code}): ${(stderr || stdout).trim().slice(0, 400) || "no output"}`));
    });

    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

async function composeWithClaudeCode(prompt: string, lengthBeats: number) {
  // Runs headless against the machine's own Claude Code login, which is why
  // this is an opt-in local setup and never the default.
  const stdout = await runClaudeCli(prompt);

  const envelope = JSON.parse(stdout) as {
    is_error?: boolean;
    result?: string;
    structured_output?: unknown;
    subtype?: string;
  };
  if (envelope.is_error) {
    throw new Error(`The claude CLI returned an error: ${String(envelope.result ?? envelope.subtype).slice(0, 300)}`);
  }

  if (envelope.structured_output && typeof envelope.structured_output === "object") {
    const payload = envelope.structured_output as Record<string, unknown>;
    return {
      notes: clampNotes(payload.notes, lengthBeats),
      explanation: typeof payload.explanation === "string" ? payload.explanation.trim() : "",
      model: COMPOSER_CLAUDE_MODEL,
    };
  }

  return { ...parsePayload(String(envelope.result ?? ""), lengthBeats), model: COMPOSER_CLAUDE_MODEL };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function callBackend(backend: ComposerBackend, prompt: string, lengthBeats: number) {
  if (backend === "anthropic-api") return composeWithAnthropicApi(prompt, lengthBeats);
  if (backend === "claude-code") return composeWithClaudeCode(prompt, lengthBeats);
  return composeWithGemini(prompt, lengthBeats);
}

export async function composePart(request: ComposeRequest): Promise<ComposeResult> {
  if (!request.brief?.trim()) throw new Error("compose needs a brief.");
  if (!Number.isFinite(request.lengthBeats) || request.lengthBeats <= 0) {
    throw new Error("compose needs a positive length in beats.");
  }

  const backend = readSettings().composer.backend;
  const prompt = buildPrompt(request);

  let result;
  try {
    result = await callBackend(backend, prompt, request.lengthBeats);
  } catch (error) {
    // Retry only a bad answer, and tell the model what was wrong with it. A
    // missing key, a dead CLI or a refusal will fail the same way twice, so
    // those go straight back to the artist.
    if (!(error instanceof UnusableAnswer)) throw error;
    const retryPrompt = `${prompt}\n\n## Your previous answer could not be used\n${error.message}\nReturn valid JSON in exactly the shape above, and nothing else.`;
    result = await callBackend(backend, retryPrompt, request.lengthBeats);
  }

  return { notes: result.notes, explanation: result.explanation, backend, model: result.model };
}
