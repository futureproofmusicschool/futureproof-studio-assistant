import fs from "node:fs";
import path from "node:path";
import { ABLETON_FUNCTION_DECLARATIONS, isAbletonTool, runAbletonTool } from "@/lib/ableton/tools";
import { readContacts, writeContacts, type LogChannel } from "@/lib/contacts";
import { REPO_ROOT, repoPath } from "@/lib/paths";

// Everything the voice agent is allowed to read. Anything outside this list
// (.env, node_modules, the rest of the machine) is refused with a string the
// model can read back to the artist.
const READABLE_DIRECTORIES = [
  { area: "memory", relative: "memory" },
  { area: "plans", relative: "plans" },
  { area: "transcripts", relative: path.join("voice", "transcripts") },
  { area: "templates", relative: path.join("interviews", "templates") },
  { area: "rules", relative: path.join(".claude", "rules") },
];

const READABLE_FILES = [
  { area: "board", relative: path.join("board", "board.json") },
  { area: "contacts", relative: path.join("contacts", "contacts.json") },
  { area: "rules", relative: "AGENTS.md" },
];

const READABLE_EXTENSIONS = new Set([".md", ".json", ".txt"]);
const MAX_FILE_BYTES = 50 * 1024;
const MAX_HITS = 10;
const CONTEXT_LINES = 2;
const OUTBOX_DIR = repoPath("outbox");

export type ToolResult = { result: unknown } | { error: string };

function toRepoRelative(absolutePath: string) {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join("/");
}

function isInside(candidate: string, directory: string) {
  return candidate === directory || candidate.startsWith(`${directory}${path.sep}`);
}

/**
 * Resolve a caller-supplied path against the whitelist. Returns null when the
 * path escapes the allowed set, including via symlink or "..".
 */
function resolveReadablePath(requested: string) {
  if (typeof requested !== "string" || !requested.trim()) return null;

  const cleaned = requested.trim().replace(/^\.\//, "");
  if (path.isAbsolute(cleaned) && !isInside(path.resolve(cleaned), REPO_ROOT)) return null;

  const absolute = path.resolve(REPO_ROOT, cleaned);
  if (!isInside(absolute, REPO_ROOT)) return null;
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null;

  let real: string;
  try {
    real = fs.realpathSync(absolute);
  } catch {
    return null;
  }

  for (const entry of READABLE_FILES) {
    if (real === fs.realpathSync(repoPath(entry.relative))) return real;
  }

  for (const entry of READABLE_DIRECTORIES) {
    const directory = repoPath(entry.relative);
    if (!fs.existsSync(directory)) continue;
    if (isInside(real, fs.realpathSync(directory)) && READABLE_EXTENSIONS.has(path.extname(real))) {
      return real;
    }
  }

  return null;
}

function collectReadableFiles(area?: string) {
  const files: string[] = [];
  const wanted = area?.trim().toLowerCase();

  for (const entry of READABLE_FILES) {
    if (wanted && entry.area !== wanted) continue;
    const absolute = repoPath(entry.relative);
    if (fs.existsSync(absolute)) files.push(absolute);
  }

  for (const entry of READABLE_DIRECTORIES) {
    if (wanted && entry.area !== wanted) continue;
    const root = repoPath(entry.relative);
    if (!fs.existsSync(root)) continue;

    const walk = (directory: string) => {
      for (const child of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, child.name);
        if (child.isDirectory()) {
          walk(absolute);
        } else if (child.isFile() && READABLE_EXTENSIONS.has(path.extname(child.name))) {
          files.push(absolute);
        }
      }
    };
    walk(root);
  }

  return files;
}

export const KNOWN_AREAS = Array.from(
  new Set([...READABLE_DIRECTORIES, ...READABLE_FILES].map((entry) => entry.area)),
);

function searchTerms(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9'-]+/i)
    .filter((term) => term.length > 2);
}

export function searchStudioFiles(query: unknown, area?: unknown): ToolResult {
  const text = typeof query === "string" ? query.trim() : "";
  if (!text) return { error: "search_studio_files needs a query." };

  const wantedArea = typeof area === "string" && area.trim() ? area.trim().toLowerCase() : undefined;
  if (wantedArea && !KNOWN_AREAS.includes(wantedArea)) {
    return { error: `Unknown area "${wantedArea}". Use one of: ${KNOWN_AREAS.join(", ")}.` };
  }

  const terms = searchTerms(text);
  const phrase = text.toLowerCase();
  const hits: { path: string; snippet: string }[] = [];

  for (const absolute of collectReadableFiles(wantedArea)) {
    if (hits.length >= MAX_HITS) break;

    let contents: string;
    try {
      contents = fs.readFileSync(absolute, "utf8");
    } catch {
      continue;
    }

    const lines = contents.split("\n");
    for (let index = 0; index < lines.length && hits.length < MAX_HITS; index += 1) {
      const line = lines[index].toLowerCase();
      const matched = line.includes(phrase) || (terms.length > 0 && terms.every((term) => line.includes(term)));
      if (!matched) continue;

      const start = Math.max(0, index - CONTEXT_LINES);
      const end = Math.min(lines.length, index + CONTEXT_LINES + 1);
      hits.push({
        path: toRepoRelative(absolute),
        snippet: lines.slice(start, end).join("\n").trim(),
      });
      // One hit per file keeps the response small enough for a voice turn.
      break;
    }
  }

  return {
    result: hits.length
      ? { hits }
      : { hits: [], note: `Nothing in the studio files matches "${text}".` },
  };
}

export function readStudioFile(requested: unknown): ToolResult {
  const resolved = resolveReadablePath(typeof requested === "string" ? requested : "");
  if (!resolved) {
    return {
      error:
        "That file is not readable. Readable areas: memory/, plans/, voice/transcripts/, interviews/templates/, .claude/rules/, board/board.json, contacts/contacts.json, AGENTS.md.",
    };
  }

  const contents = fs.readFileSync(resolved, "utf8");
  const truncated = contents.length > MAX_FILE_BYTES;

  return {
    result: {
      path: toRepoRelative(resolved),
      contents: truncated ? contents.slice(0, MAX_FILE_BYTES) : contents,
      ...(truncated ? { truncated: true } : {}),
    },
  };
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "draft"
  );
}

function dayStamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function draftEmail(args: Record<string, unknown>): ToolResult {
  const to = typeof args.to === "string" ? args.to.trim() : "";
  const subject = typeof args.subject === "string" ? args.subject.trim() : "";
  const body = typeof args.body === "string" ? args.body.trim() : "";
  const contactId = typeof args.contactId === "string" ? args.contactId.trim() : "";

  if (!to || !subject || !body) {
    return { error: "draft_email needs to, subject, and body." };
  }

  const now = new Date();
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });

  const base = `${dayStamp(now)}-${slugify(subject)}`;
  let filename = `${base}.md`;
  let counter = 2;
  while (fs.existsSync(path.join(OUTBOX_DIR, filename))) {
    filename = `${base}-${counter}.md`;
    counter += 1;
  }

  const frontmatter = [
    "---",
    `to: ${to}`,
    `subject: ${subject}`,
    `date: ${now.toISOString()}`,
    ...(contactId ? [`contactId: ${contactId}`] : []),
    "sent: false",
    "---",
    "",
  ].join("\n");

  const outputPath = path.join(OUTBOX_DIR, filename);
  fs.writeFileSync(outputPath, `${frontmatter}${body}\n`, "utf8");

  let loggedContact: string | null = null;
  if (contactId) {
    try {
      const contacts = readContacts();
      const contact = contacts.contacts.find((entry) => entry.id === contactId);
      if (contact) {
        contact.log.push({
          date: now.toISOString(),
          channel: "email" as LogChannel,
          summary: `DRAFTED (not sent): ${subject}`,
        });
        contact.updatedAt = now.toISOString();
        writeContacts(contacts);
        loggedContact = contact.name;
      }
    } catch {
      // A contacts-file problem must not lose the draft that is already on disk.
    }
  }

  return {
    result: {
      path: toRepoRelative(outputPath),
      sent: false,
      note: "Draft written to outbox. Nothing was sent. The artist sends it after reading it.",
      ...(loggedContact ? { loggedTo: loggedContact } : {}),
    },
  };
}

export async function runStudioTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (isAbletonTool(name)) return runAbletonTool(name, args);

  switch (name) {
    case "search_studio_files":
      return searchStudioFiles(args.query, args.area);
    case "read_studio_file":
      return readStudioFile(args.path);
    case "draft_email":
      return draftEmail(args);
    // v2: board/contacts mutation tools
    // v2: Ableton editing beyond notes/clips (load devices, browser) lives in lib/ableton/tools.ts
    default:
      return { error: `Unknown tool "${name}".` };
  }
}

export const FUNCTION_DECLARATIONS = [
  {
    name: "search_studio_files",
    description:
      "Search the studio files (memory, plans, past voice transcripts, session-mode templates, the board, contacts, project rules) for a word or phrase. Returns up to ten short snippets with their file paths. Use this before answering anything about past sessions, taste notes, procedures, or a contact's history.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Words or a phrase to look for." },
        area: {
          type: "STRING",
          description: `Optional narrowing: one of ${KNOWN_AREAS.join(", ")}.`,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_studio_file",
    description:
      "Read the full contents of one studio file by its repo-relative path, for example memory/working-self.md or contacts/contacts.json. Use it after search_studio_files finds a promising hit.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "Repo-relative path, e.g. memory/working-self.md." },
      },
      required: ["path"],
    },
  },
  {
    name: "draft_email",
    description:
      "Write an email draft to a file in outbox/. This never sends anything: the artist reads the draft and sends it. Pass contactId when the recipient is in contacts.json so the draft is logged against them.",
    parameters: {
      type: "OBJECT",
      properties: {
        to: { type: "STRING", description: "Recipient name or address." },
        subject: { type: "STRING", description: "Subject line." },
        body: { type: "STRING", description: "Full body of the email." },
        contactId: { type: "STRING", description: "Optional contacts.json id, e.g. k_rcox4wrld." },
      },
      required: ["to", "subject", "body"],
    },
  },
  // v2: board/contacts mutation tools
  ...ABLETON_FUNCTION_DECLARATIONS,
];
