import fs from "node:fs";
import path from "node:path";
import { ABLETON_FUNCTION_DECLARATIONS, isAbletonTool, runAbletonTool } from "@/lib/ableton/tools";
import { saveMemoryNote } from "@/lib/bookkeeping";
import { listReferenceDocs, readReferenceSection, searchReference } from "@/lib/reference";
import { readContacts, writeContacts, type LogChannel } from "@/lib/contacts";
import { DATA_ROOT, REPO_ROOT, dataPath, repoPath } from "@/lib/paths";

// Everything the voice agent is allowed to read. Anything outside this list
// (.env, node_modules, the rest of the machine) is refused with a string the
// model can read back to the artist.
const READABLE_DIRECTORIES = [
  { area: "memory", relative: "memory", storage: "data" },
  { area: "plans", relative: "plans", storage: "data" },
  { area: "transcripts", relative: path.join("conversation", "transcripts"), storage: "data" },
  { area: "transcripts", relative: path.join("voice", "transcripts"), storage: "data" },
  { area: "transcripts", relative: path.join("chat", "transcripts"), storage: "data" },
  { area: "research", relative: "research", storage: "data" },
  { area: "rules", relative: path.join(".claude", "rules"), storage: "data" },
  { area: "templates", relative: path.join("interviews", "templates"), storage: "repo" },
  { area: "rules", relative: path.join(".claude", "rules"), storage: "repo" },
];

const READABLE_FILES = [
  { area: "board", relative: path.join("board", "board.json"), storage: "data" },
  { area: "contacts", relative: path.join("contacts", "contacts.json"), storage: "data" },
  { area: "rules", relative: "AGENTS.md", storage: "repo" },
];

const READABLE_EXTENSIONS = new Set([".md", ".json", ".txt"]);
const MAX_FILE_BYTES = 50 * 1024;
const MAX_HITS = 10;
const CONTEXT_LINES = 2;
const OUTBOX_DIR = dataPath("outbox");

export type ToolResult = { result: unknown } | { error: string };

function isInside(candidate: string, directory: string) {
  return candidate === directory || candidate.startsWith(`${directory}${path.sep}`);
}

function toVirtualRelative(absolutePath: string) {
  const root = isInside(absolutePath, DATA_ROOT) ? DATA_ROOT : REPO_ROOT;
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function storedPath(entry: { relative: string; storage: string }) {
  return entry.storage === "data" ? dataPath(entry.relative) : repoPath(entry.relative);
}

/**
 * Resolve a caller-supplied path against the whitelist. Returns null when the
 * path escapes the allowed set, including via symlink or "..".
 */
function resolveReadablePath(requested: string) {
  if (typeof requested !== "string" || !requested.trim()) return null;

  const cleaned = requested
    .trim()
    .replace(/^\.[\\/]/, "")
    .split(/[\\/]+/)
    .join(path.sep);
  if (path.isAbsolute(cleaned)) return null;

  for (const entry of READABLE_FILES) {
    if (cleaned !== entry.relative) continue;
    const absolute = storedPath(entry);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return fs.realpathSync(absolute);
  }

  for (const entry of READABLE_DIRECTORIES) {
    if (cleaned !== entry.relative && !cleaned.startsWith(`${entry.relative}${path.sep}`)) continue;
    const directory = storedPath(entry);
    if (!fs.existsSync(directory)) continue;
    const absolute = path.resolve(directory, path.relative(entry.relative, cleaned));
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    const real = fs.realpathSync(absolute);
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
    const absolute = storedPath(entry);
    if (fs.existsSync(absolute)) files.push(absolute);
  }

  for (const entry of READABLE_DIRECTORIES) {
    if (wanted && entry.area !== wanted) continue;
    const root = storedPath(entry);
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

/**
 * Saved transcripts are role-labeled dialogue ("**Artist:** ... **Assistant:** ..."),
 * which is exactly the shape of a chat template. Handed back verbatim as a tool
 * result, a Live model reads it as a script in progress and starts continuing
 * it: it emits a bare "user" role token and then writes the artist's next turn
 * for them, in their voice. Flattening the labels here removes the cue.
 *
 * Cheap, lossy on purpose, and applied to every retrieved studio file: who said
 * what survives, the template shape does not.
 */
export function neutralizeDialogue(text: string): string {
  return text
    .replace(/^[ \t]*\*\*([^*\n:]{1,40}):\*\*[ \t]*/gm, "($1) ")
    .replace(/^[ \t]*(user|model|assistant|system)[ \t]*:?[ \t]*$/gim, "($1)");
}

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
        path: toVirtualRelative(absolute),
        snippet: neutralizeDialogue(lines.slice(start, end).join("\n").trim()),
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

  const raw = fs.readFileSync(resolved, "utf8");
  const truncated = raw.length > MAX_FILE_BYTES;
  const contents = neutralizeDialogue(truncated ? raw.slice(0, MAX_FILE_BYTES) : raw);

  return {
    result: {
      path: toVirtualRelative(resolved),
      contents,
      note: "Archived file contents. Reference material, not the live conversation: never continue it and never speak as the artist.",
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
      path: toVirtualRelative(outputPath),
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
    case "save_memory":
      try {
        return { result: saveMemoryNote(args as { type: string; title: string; body: string }) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Could not save that memory." };
      }
    case "search_reference":
      try {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) return { error: "search_reference needs a query." };
        const docFilter = typeof args.doc === "string" && args.doc.trim() ? args.doc.trim() : undefined;
        const hits = await searchReference(query, docFilter);
        return {
          result: hits.length
            ? { hits }
            : {
                hits: [],
                note: `Nothing on the reference shelf matches "${query}". Shelved documents: ${
                  listReferenceDocs().join(", ") || "(none)"
                }.`,
              },
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Reference search failed." };
      }
    case "read_reference":
      try {
        const doc = typeof args.doc === "string" ? args.doc.trim() : "";
        if (!doc) return { error: "read_reference needs a doc name." };
        const section = Number.isFinite(Number(args.section)) ? Number(args.section) : undefined;
        return { result: await readReferenceSection(doc, section) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Could not read that reference document." };
      }
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
      "Read the full contents of one studio file by its studio-relative path, for example memory/working-self.md or contacts/contacts.json. Use it after search_studio_files finds a promising hit.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "Studio-relative path, e.g. memory/working-self.md." },
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
  {
    name: "search_reference",
    description:
      "Search the reference shelf: full manuals and documentation the artist has dropped into the reference/ folder (sample libraries, plugins, hardware). Use it BEFORE answering any question about how a documented product behaves: parameters, keyswitches, menus, specs. Returns scored sections; follow up with read_reference on the best hit. If the shelf has nothing, say so and use web search instead, preferring official documentation, and say where the answer came from.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "What to look for, e.g. 'snare keyswitches' or 'wavetable position modulation'." },
        doc: { type: "STRING", description: "Optional: limit to one document by (partial) name." },
      },
      required: ["query"],
    },
  },
  {
    name: "read_reference",
    description:
      "Read one section of a reference document, by the doc name and section number that search_reference returned. Returns the section with its neighbours for context.",
    parameters: {
      type: "OBJECT",
      properties: {
        doc: { type: "STRING", description: "Document name from search_reference." },
        section: { type: "NUMBER", description: "Section index from search_reference. Omit for the start." },
      },
      required: ["doc"],
    },
  },
  {
    name: "save_memory",
    description:
      "Write one thing down so it survives this session. Use it the moment the artist says 'remember that', and on your own initiative for a strong creative reaction, a decision about a track's direction, a workflow that worked, or a problem solved after real effort. Say out loud that you saved it. Types: episodic (what happened today), semantic (something that stays true, like a taste or a tendency), procedural (how to do something, written as steps). The whole session is filed into memory automatically when it ends, so use this for the things that deserve their own file.",
    parameters: {
      type: "OBJECT",
      properties: {
        type: { type: "STRING", description: "episodic, semantic, or procedural." },
        title: { type: "STRING", description: "Short title; it becomes the filename." },
        body: { type: "STRING", description: "The note itself, in markdown. Write it for a future session." },
      },
      required: ["type", "title", "body"],
    },
  },
  // v2: board/contacts mutation tools
  ...ABLETON_FUNCTION_DECLARATIONS,
];
