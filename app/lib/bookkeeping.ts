import fs from "node:fs";
import path from "node:path";
import { readGeminiApiKey } from "@/lib/env";
import { BOOKKEEPING_MODEL } from "@/lib/models";
import { DATA_ROOT, dataPath, repoPath } from "@/lib/paths";

/**
 * Internal bookkeeping: filing a finished voice session into memory.
 *
 * This used to be the CLI assistant's job, which meant "the assistant that
 * never forgets" quietly depended on a second paid account. It runs on Gemini
 * Flash through the same key the voice session already uses, so a fresh
 * install remembers things out of the box. Everything the machine files is
 * stamped `filed-by: gemini-flash` so a human can audit it later.
 */

const MEMORY_DIR = dataPath("memory");
const EPISODIC_DIR = path.join(MEMORY_DIR, "episodic");
const SEMANTIC_DIR = path.join(MEMORY_DIR, "semantic");
const PROCEDURAL_DIR = path.join(MEMORY_DIR, "procedural");
const WORKING_SELF_PATH = path.join(MEMORY_DIR, "working-self.md");
const MEMORY_RULES_PATH = repoPath(".claude", "rules", "memory.md");

const FILED_BY = "gemini-flash";
const WORKING_SELF_MAX_LINES = 100;
const MAX_TRANSCRIPT_BYTES = 200 * 1024;

export type FiledResult = {
  episodic: string | null;
  semantic: string[];
  workingSelfUpdated: boolean;
};

function readOrEmpty(filePath: string) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "session"
  );
}

function toDataRelative(absolutePath: string) {
  return path.relative(DATA_ROOT, absolutePath).split(path.sep).join("/");
}

function dayStamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Never clobber: a second file the same day gets a -2 suffix. */
function uniquePath(directory: string, filename: string) {
  fs.mkdirSync(directory, { recursive: true });
  const base = filename.replace(/\.md$/, "");
  let candidate = path.join(directory, `${base}.md`);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${base}-${counter}.md`);
    counter += 1;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// save_memory: no model call, just a well-formed file
// ---------------------------------------------------------------------------

export type MemoryType = "episodic" | "semantic" | "procedural";

const DIRECTORY_FOR: Record<MemoryType, string> = {
  episodic: EPISODIC_DIR,
  semantic: SEMANTIC_DIR,
  procedural: PROCEDURAL_DIR,
};

/**
 * The "remember this" moment, done live. Deliberately trivial: the voice model
 * already knows what it wants to save, so no second model call is warranted.
 */
export function saveMemoryNote(args: { type: string; title: string; body: string }) {
  const type = String(args.type ?? "").trim() as MemoryType;
  if (!DIRECTORY_FOR[type]) throw new Error("type must be episodic, semantic, or procedural.");

  const title = String(args.title ?? "").trim();
  const body = String(args.body ?? "").trim();
  if (!title) throw new Error("save_memory needs a title.");
  if (!body) throw new Error("save_memory needs a body.");

  const now = new Date();
  const slug = slugify(title);
  const filename = type === "episodic" ? `${dayStamp(now)}-${slug}` : slug;

  const frontmatter = [
    "---",
    `type: ${type}`,
    type === "episodic" ? `date: ${dayStamp(now)}` : `last_validated: ${dayStamp(now)}`,
    ...(type === "episodic" ? ["outcome: pending"] : []),
    ...(type === "semantic" ? ["confidence: medium"] : []),
    `filed-by: ${FILED_BY}`,
    "---",
    "",
  ].join("\n");

  const target = uniquePath(DIRECTORY_FOR[type], filename);
  fs.writeFileSync(target, `${frontmatter}# ${title}\n\n${body}\n`, "utf8");
  return { path: toDataRelative(target), type };
}

// ---------------------------------------------------------------------------
// fileTranscript: one Flash call, then plain file writes
// ---------------------------------------------------------------------------

const FILING_SCHEMA = {
  type: "OBJECT",
  properties: {
    episodic: {
      type: "OBJECT",
      nullable: true,
      properties: {
        title: { type: "STRING", description: "Short title, e.g. 'Percussion groove for the opener'." },
        tags: { type: "ARRAY", items: { type: "STRING" }, description: "2-5 lowercase kebab-case tags." },
        outcome: { type: "STRING", enum: ["pending", "success", "failure", "mixed"] },
        body: {
          type: "STRING",
          description:
            "Markdown. What happened, why, what was decided, what to follow up on. No frontmatter, no top-level heading.",
        },
      },
      required: ["title", "tags", "outcome", "body"],
    },
    workingSelfUpdate: {
      type: "STRING",
      nullable: true,
      description:
        "The complete new contents of working-self.md when this session actually changed the state of a project, otherwise null. A full rewrite: anything omitted is deleted, so carry unrelated lines forward verbatim. Under 100 lines.",
    },
    semanticNotes: {
      type: "ARRAY",
      description: "Usually empty. Only durable, validated facts about taste or method.",
      items: {
        type: "OBJECT",
        properties: {
          slug: { type: "STRING", description: "category-topic, e.g. taste-percussion." },
          category: { type: "STRING", enum: ["taste", "workflow", "sound-design", "mixing", "arrangement"] },
          title: { type: "STRING" },
          body: { type: "STRING", description: "Markdown. The fact, the evidence, what it means next time." },
        },
        required: ["slug", "category", "title", "body"],
      },
    },
  },
  required: ["episodic", "workingSelfUpdate", "semanticNotes"],
} as const;

type FilingPayload = {
  episodic: { title: string; tags: string[]; outcome: string; body: string } | null;
  workingSelfUpdate: string | null;
  semanticNotes: { slug: string; category: string; title: string; body: string }[] | null;
};

function buildFilingPrompt(transcript: string) {
  return [
    "You are the studio assistant's bookkeeper. A voice session just ended. File it into the memory system.",
    "",
    "## The memory system's own rules",
    readOrEmpty(MEMORY_RULES_PATH) || "(the rules file could not be read; use your judgement)",
    "",
    "## Current working self (memory/working-self.md)",
    readOrEmpty(WORKING_SELF_PATH) || "(empty)",
    "",
    "## The transcript",
    transcript,
    "",
    "## What to return",
    "- episodic: one record of this session, unless nothing of substance happened (then null). Write it for a future session that has no memory of today: what happened, what was decided, what is still open.",
    "- workingSelfUpdate: the complete rewritten working-self.md ONLY if this session actually changed the state of a project. Otherwise null. It is a rewrite, so everything you leave out is deleted: carry every existing line forward unless this session actually superseded it. Never drop an open question, a blocker, an active project, or a decision that is still live just because this session did not mention it. Keep it under 100 lines by compressing what is settled, never by dropping what is unresolved. Preserve the file's existing structure and its [[wiki links]].",
    "- semanticNotes: rarely anything. Only durable, validated facts about the artist's taste or method that will still be true in six months. A passing preference is not one. When in doubt, return an empty array.",
    "Never invent detail the transcript does not support. Write plainly, no marketing tone, no em dashes.",
  ].join("\n");
}

async function callFlash(prompt: string): Promise<FilingPayload> {
  const key = readGeminiApiKey();
  if (!key) throw new Error("No Gemini API key is saved, so the transcript could not be filed.");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${BOOKKEEPING_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: FILING_SCHEMA,
          maxOutputTokens: 16000,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Flash refused the filing request (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }

  const body = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("Flash returned nothing to file.");

  return JSON.parse(text) as FilingPayload;
}

/**
 * Reads a saved transcript and files it. Throws on failure; callers treat that
 * as "not filed" and never let it cost the artist the transcript itself.
 */
export async function fileTranscript(transcriptRelativePath: string): Promise<FiledResult> {
  const absolute = path.resolve(DATA_ROOT, transcriptRelativePath);
  const transcriptRoot = path.join(DATA_ROOT, "voice", "transcripts");
  if (absolute !== transcriptRoot && !absolute.startsWith(`${transcriptRoot}${path.sep}`)) {
    throw new Error("Only voice transcripts can be filed.");
  }

  const transcript = fs.readFileSync(absolute, "utf8").slice(0, MAX_TRANSCRIPT_BYTES);
  const payload = await callFlash(buildFilingPrompt(transcript));

  const now = new Date();
  const result: FiledResult = { episodic: null, semantic: [], workingSelfUpdated: false };

  if (payload.episodic?.title && payload.episodic.body) {
    const tags = Array.isArray(payload.episodic.tags) ? payload.episodic.tags.filter(Boolean).slice(0, 6) : [];
    const outcome = ["pending", "success", "failure", "mixed"].includes(payload.episodic.outcome)
      ? payload.episodic.outcome
      : "pending";
    const frontmatter = [
      "---",
      "type: episodic",
      `date: ${dayStamp(now)}`,
      `tags: [${tags.join(", ")}]`,
      `outcome: ${outcome}`,
      `source: ${transcriptRelativePath}`,
      `filed-by: ${FILED_BY}`,
      "---",
      "",
    ].join("\n");

    const target = uniquePath(EPISODIC_DIR, `${dayStamp(now)}-${slugify(payload.episodic.title)}`);
    fs.writeFileSync(target, `${frontmatter}# ${payload.episodic.title}\n\n${payload.episodic.body.trim()}\n`, "utf8");
    result.episodic = toDataRelative(target);
  }

  if (typeof payload.workingSelfUpdate === "string" && payload.workingSelfUpdate.trim()) {
    const lines = payload.workingSelfUpdate.trim().split("\n").slice(0, WORKING_SELF_MAX_LINES);
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
    fs.writeFileSync(WORKING_SELF_PATH, `${lines.join("\n")}\n`, "utf8");
    result.workingSelfUpdated = true;
  }

  for (const note of payload.semanticNotes ?? []) {
    if (!note?.slug || !note.title || !note.body) continue;
    const frontmatter = [
      "---",
      "type: semantic",
      `category: ${note.category || "taste"}`,
      `last_validated: ${dayStamp(now)}`,
      "confidence: medium",
      `source: ${transcriptRelativePath}`,
      `filed-by: ${FILED_BY}`,
      "---",
      "",
    ].join("\n");

    const target = uniquePath(SEMANTIC_DIR, slugify(note.slug));
    fs.writeFileSync(target, `${frontmatter}# ${note.title}\n\n${note.body.trim()}\n`, "utf8");
      result.semantic.push(toDataRelative(target));
  }

  return result;
}
