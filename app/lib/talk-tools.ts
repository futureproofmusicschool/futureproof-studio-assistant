import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ABLETON_FUNCTION_DECLARATIONS, isAbletonTool, runAbletonTool } from "@/lib/ableton/tools";
import { writeArtifact } from "@/lib/artifacts";
import { saveMemoryNote } from "@/lib/bookkeeping";
import { listDocuments, readDocument, writeDocument, type WriteMode } from "@/lib/documents";
import { appendContactLog, readContacts } from "@/lib/contacts";
import { createGmailDraft } from "@/lib/google/gmail";
import { listReferenceDocs, readReferenceSection, searchReference } from "@/lib/reference";
import { DATA_ROOT, REPO_ROOT, dataPath, repoPath } from "@/lib/paths";

// Everything the voice agent is allowed to read. Anything outside this list
// (.env, node_modules, the rest of the machine) is refused with a string the
// model can read back to the artist.
const READABLE_DIRECTORIES = [
  { area: "artifacts", relative: "artifacts", storage: "data" },
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
  { area: "rules", relative: "AGENTS.md", storage: "repo" },
];

const READABLE_EXTENSIONS = new Set([".css", ".csv", ".html", ".js", ".json", ".md", ".svg", ".txt"]);
const MAX_FILE_BYTES = 50 * 1024;
const MAX_HITS = 10;
const CONTEXT_LINES = 2;

export type ToolResult = { result: unknown } | { error: string };
export type ToolExecutionContext = { operationId?: string };

function stableToolValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableToolValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableToolValue(nested)]),
    );
  }
  return value;
}

function toolOperationId(
  name: string,
  args: Record<string, unknown>,
  context?: ToolExecutionContext,
) {
  const provided = context?.operationId?.trim();
  if (provided) return provided;
  // Compatibility for direct/older callers. Gemini text and Live paths pass a
  // provider call id; this deterministic payload fallback is safer than a
  // random id because retrying a lost response cannot duplicate a side effect.
  return `legacy-tool:${createHash("sha256")
    .update(`${name}\0${JSON.stringify(stableToolValue(args))}`)
    .digest("hex")}`;
}

function contactHistoryOperationId(operationId: string) {
  return `h_${createHash("sha256")
    .update(`${operationId}:contact-history`)
    .digest("hex")
    .slice(0, 32)}`;
}

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
    const within = path.relative(entry.relative, cleaned);
    // Hidden directories hold indexes and bookkeeping, not user-facing content.
    if (within.split(path.sep).some((segment) => segment.startsWith("."))) continue;
    const absolute = path.resolve(directory, within);
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
        if (child.name.startsWith(".")) continue;
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
        "That file is not readable. Readable areas: memory/, plans/, conversation/transcripts/, voice/transcripts/, interviews/templates/, research/, .claude/rules/, board/board.json, and AGENTS.md. Use the dedicated Google Docs and Contacts tools for cloud data.",
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

export async function draftEmail(
  args: Record<string, unknown>,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const to = typeof args.to === "string" ? args.to.trim() : "";
  const subject = typeof args.subject === "string" ? args.subject.trim() : "";
  const body = typeof args.body === "string" ? args.body.trim() : "";
  const contactId = typeof args.contactId === "string" ? args.contactId.trim() : "";

  if (!to || !subject || !body) {
    return { error: "draft_email needs to, subject, and body." };
  }

  try {
    const operationId = toolOperationId("draft_email", args, context);
    const draft = await createGmailDraft({
      to,
      subject,
      body,
      operationId,
    });
    let loggedContact: string | null = null;
    let logWarning: string | null = null;

    if (contactId) {
      try {
        const contacts = await readContacts();
        const contact = contacts.contacts.find((entry) => entry.id === contactId);
        if (!contact) {
          logWarning = `The Gmail draft exists, but no outreach contact has id "${contactId}", so it was not logged.`;
        } else if (
          await appendContactLog(
            contactId,
            {
              date: draft.createdAt,
              channel: "email",
              summary: `DRAFTED in Gmail (not sent): ${subject}`,
            },
            contactHistoryOperationId(operationId),
          )
        ) {
          loggedContact = contact.name;
        } else {
          logWarning = `The Gmail draft exists, but it could not be logged to ${contact.name}.`;
        }
      } catch (error) {
        // Creating the draft is the important irreversible result. A Sheets
        // problem is reported separately so a retry does not duplicate it.
        logWarning = `The Gmail draft exists, but outreach logging failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`;
      }
    }

    return {
      result: {
        ...draft,
        note: "Draft created in Gmail. Nothing was sent; the artist reviews and sends it from Gmail.",
        ...(loggedContact ? { loggedTo: loggedContact } : {}),
        ...(logWarning ? { warning: logWarning } : {}),
      },
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not create the Gmail draft." };
  }
}

export async function runStudioTool(
  name: string,
  args: Record<string, unknown>,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  if (isAbletonTool(name)) return runAbletonTool(name, args);

  switch (name) {
    case "search_studio_files":
      return searchStudioFiles(args.query, args.area);
    case "read_studio_file":
      return readStudioFile(args.path);
    case "write_studio_file":
      try {
        return {
          result: {
            ...writeArtifact({
              path: typeof args.path === "string" ? args.path : "",
              content: typeof args.content === "string" ? args.content : "",
              overwrite: args.overwrite === true,
            }),
            note: "Saved as a private local artifact in the external student-data folder. Report the exact path; do not paste the file contents into chat.",
          },
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Could not save that local artifact." };
      }
    case "draft_email":
      return await draftEmail(args, context);
    case "search_contacts":
      try {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) return { error: "search_contacts needs a query." };
        const terms = searchTerms(query);
        const contacts = await readContacts();
        const matches = contacts.contacts
          .filter((contact) => {
            const searchable = [
              contact.name,
              contact.role,
              contact.contact,
              contact.notes,
              contact.status,
              contacts.categories.find((category) => category.id === contact.category)?.name ?? "",
              ...contact.log.map((entry) => `${entry.date} ${entry.channel} ${entry.summary}`),
            ]
              .join("\n")
              .toLowerCase();
            return searchable.includes(query.toLowerCase()) || terms.every((term) => searchable.includes(term));
          })
          .slice(0, MAX_HITS)
          .map((contact) => ({
            id: contact.id,
            name: contact.name,
            role: contact.role,
            contact: contact.contact,
            status: contact.status,
            lastContact: contact.lastContact,
          }));
        return {
          result: matches.length
            ? { contacts: matches }
            : { contacts: [], note: `No outreach contact matches "${query}".` },
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Could not search the Google outreach list." };
      }
    case "read_contact":
      try {
        const contactId =
          typeof args.contactId === "string"
            ? args.contactId.trim()
            : typeof args.id === "string"
              ? args.id.trim()
              : "";
        if (!contactId) return { error: "read_contact needs a contactId." };
        const contacts = await readContacts();
        const contact = contacts.contacts.find((entry) => entry.id === contactId);
        if (!contact) {
          return { error: `No outreach contact has id "${contactId}". Call search_contacts to find it.` };
        }
        return {
          result: {
            ...contact,
            categoryName:
              contacts.categories.find((category) => category.id === contact.category)?.name ?? contact.category,
          },
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Could not read that Google contact." };
      }
    case "write_document":
      try {
        const documentId =
          typeof args.documentId === "string"
            ? args.documentId.trim()
            : typeof args.slug === "string"
              ? args.slug.trim()
              : undefined;
        const document = await writeDocument({
          title: typeof args.title === "string" ? args.title : undefined,
          documentId,
          body: typeof args.body === "string" ? args.body : "",
          mode: args.mode === "append" ? ("append" as WriteMode) : ("replace" as WriteMode),
          expectedRevisionId:
            typeof args.expectedRevisionId === "string" ? args.expectedRevisionId.trim() : undefined,
          operationId: toolOperationId("write_document", args, context),
        });
        return {
          result: {
            documentId: document.id,
            title: document.title,
            webViewLink: document.webViewLink,
            revisionId: document.revisionId,
            updated: document.updatedAt,
            note: `Saved as a Google Doc in the Docs tab: "${document.title}". Tell the artist the title so they can find it.`,
          },
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Could not save that document." };
      }
    case "list_documents":
      try {
        const documents = (await listDocuments()).map((document) => ({
          documentId: document.id,
          title: document.title,
          updated: document.updatedAt.slice(0, 10),
          excerpt: document.excerpt,
          webViewLink: document.webViewLink,
        }));
        return {
          result: documents.length
            ? { documents }
            : { documents: [], note: "No documents have been written yet." },
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Could not list the documents." };
      }
    case "read_document":
      try {
        const documentId =
          typeof args.documentId === "string"
            ? args.documentId.trim()
            : typeof args.slug === "string"
              ? args.slug.trim()
              : "";
        const document = documentId ? await readDocument(documentId) : null;
        if (!document) {
          return {
            error: `No managed Google Doc with id "${documentId}". Call list_documents to see what exists.`,
          };
        }
        const requestedOffset = Number(args.offset ?? 0);
        const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
        const end = Math.min(document.body.length, offset + MAX_FILE_BYTES);
        return {
          result: {
            documentId: document.id,
            title: document.title,
            updated: document.updatedAt,
            webViewLink: document.webViewLink,
            revisionId: document.revisionId,
            offset,
            contents: neutralizeDialogue(document.body.slice(offset, end)),
            totalCharacters: document.body.length,
            ...(end < document.body.length ? { truncated: true, nextOffset: end } : {}),
          },
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Could not read that document." };
      }
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
      "Search the allowed local studio files (memory, plans, past transcripts, research jobs, session-mode templates, the board, and project rules) for a word or phrase. Returns up to ten short snippets with their file paths. Google Docs and Contacts have dedicated tools and are not part of this local search.",
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
      "Read the full contents of one allowed local studio file by its studio-relative path, for example memory/working-self.md. Use it after search_studio_files finds a promising hit; use read_document or read_contact for Google data.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "Studio-relative path, e.g. memory/working-self.md." },
      },
      required: ["path"],
    },
  },
  {
    name: "write_studio_file",
    description:
      "Create a private local artifact in the external student-data folder, such as an HTML page, script, SVG, CSV, or markdown file. Use this instead of pasting a large file into the conversation. Paths are relative to artifacts/ and may use subfolders. Existing files are protected unless overwrite is true and the artist asked to replace them. After saving, report the exact returned path and summarize the result briefly; never duplicate the full content in chat.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description: "Filename under artifacts/, e.g. indian-rudiments.html or practice/routine.html.",
        },
        content: {
          type: "STRING",
          description: "The complete file contents. Put the artifact here, not in the visible conversation.",
        },
        overwrite: {
          type: "BOOLEAN",
          description: "Set true only when the artist explicitly asked to replace an existing artifact.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "write_document",
    description:
      "Create or update a native Google Doc the artist can edit, share, and keep: a contact list, research findings, a release plan, options worked out together, or notes from this conversation. Managed Docs show up in the app's Docs tab. Use this whenever you produce more than a couple of actionable items or something the artist will want later; do not put that in save_memory, because memory is your own notebook. Say the title when you save one. To update an existing document, call read_document first and pass its documentId; mode append adds safely, while replace also requires that read's revisionId.",
    parameters: {
      type: "OBJECT",
      properties: {
        title: {
          type: "STRING",
          description: "Short human title, e.g. 'Percussionists to contact'. It names the Google Doc and Docs entry.",
        },
        body: {
          type: "STRING",
          description:
            "The document itself, in markdown. Headings, lists, and tables are fine and usually better than prose. Do not repeat the title as a heading at the top; the app shows it. With mode append, send only the new part.",
        },
        mode: {
          type: "STRING",
          description:
            "replace (default) rewrites the whole document; append adds to the end of an existing one. Appending is the safe choice when adding to a list.",
        },
        documentId: {
          type: "STRING",
          description: "Optional: the exact Google document id of an existing managed document, from list_documents.",
        },
        expectedRevisionId: {
          type: "STRING",
          description:
            "Required when replacing an existing document: pass the revisionId from the most recent read_document result. Omit for create or append.",
        },
      },
      required: ["title", "body"],
    },
  },
  {
    name: "list_documents",
    description:
      "List the native Google Docs managed by Studio Assistant with titles, document ids, links, excerpts, and update dates. Call this before updating, when the artist refers to something written earlier, or when they ask what is on file.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "read_document",
    description:
      "Read one managed Google Doc by its documentId from list_documents. Long documents are paged; when truncated is true, call again with nextOffset until every page has been read before replacing the document.",
    parameters: {
      type: "OBJECT",
      properties: {
        documentId: { type: "STRING", description: "Google document id from list_documents." },
        offset: {
          type: "NUMBER",
          description: "Character offset for the next page. Omit for the first page; then use nextOffset verbatim.",
        },
      },
      required: ["documentId"],
    },
  },
  {
    name: "search_contacts",
    description:
      "Search the connected Google outreach list, including names, roles, contact details, notes, status, categories, and correspondence summaries. In normal connector mode this list lives in the managed Sheet; Advanced direct mode can use Google Contacts for identity. Returns compact matches and stable contact ids; call read_contact for full history.",
    parameters: {
      type: "OBJECT",
      properties: { query: { type: "STRING", description: "Name, address, role, status, or words from outreach notes/history." } },
      required: ["query"],
    },
  },
  {
    name: "read_contact",
    description:
      "Read one outreach contact in full by the stable contactId returned by search_contacts or included in the session's outreach digest. Includes identity fields, status, notes, and correspondence history from the connected Google store.",
    parameters: {
      type: "OBJECT",
      properties: { contactId: { type: "STRING", description: "Stable outreach contact id." } },
      required: ["contactId"],
    },
  },
  {
    name: "draft_email",
    description:
      "Create a real draft in the connected Gmail account. This NEVER sends email: the artist reviews and sends it from Gmail. Pass contactId when the recipient is in the outreach tracker so the draft is logged in the outreach Sheet.",
    parameters: {
      type: "OBJECT",
      properties: {
        to: { type: "STRING", description: "Recipient name or address." },
        subject: { type: "STRING", description: "Subject line." },
        body: { type: "STRING", description: "Full body of the email." },
        contactId: { type: "STRING", description: "Optional stable outreach contact id from search_contacts." },
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
      "Write one thing down so it survives this session. Use it the moment the artist says 'remember that', and on your own initiative for a strong creative reaction, a decision about a track's direction, a workflow that worked, or a problem solved after real effort. Say out loud that you saved it. Types: episodic (what happened today), semantic (something that stays true, like a taste or a tendency), procedural (how to do something, written as steps). The rolling conversation is saved continuously and completed days are filed automatically, so use this for the things that deserve their own file immediately. This is your own notebook and the artist does not read it: anything they will want to open later, especially a list, belongs in write_document instead.",
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
