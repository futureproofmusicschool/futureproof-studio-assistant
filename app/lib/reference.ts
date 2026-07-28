import fs from "node:fs";
import path from "node:path";
import { dataPath } from "@/lib/paths";

/**
 * The reference shelf holds full manuals (PDF, docx, text,
 * markdown) that the voice agent searches on demand. Everything is local to
 * the student's external data directory: no index to host, no service to run.
 * PDFs and docx files are extracted to a text sidecar in reference/.cache/ the first time they are
 * touched, then treated like any other text.
 *
 * This is deliberately not a vector store. At the scale of a shelf of manuals,
 * section-level term search answers "where does the manual talk about X" well
 * enough, and there is nothing to ship, embed, or keep warm.
 */

const REFERENCE_DIR = dataPath("reference");
const CACHE_DIR = path.join(REFERENCE_DIR, ".cache");

const EXTRACTABLE = new Set([".pdf", ".docx"]);
const PLAIN_TEXT = new Set([".md", ".txt"]);

/** Sections aim for this size: big enough to be readable, small enough for a voice turn. */
const TARGET_SECTION_CHARS = 1800;
const MAX_SECTION_CHARS = 4000;
const MAX_HITS = 8;
// Vendor manuals routinely carry 40MB of screenshots; the text extracts fine.
const MAX_DOC_BYTES = 80 * 1024 * 1024;

export type ReferenceHit = {
  doc: string;
  section: number;
  heading: string;
  snippet: string;
  score: number;
};

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

function isReferenceFile(name: string) {
  const ext = path.extname(name).toLowerCase();
  return (EXTRACTABLE.has(ext) || PLAIN_TEXT.has(ext)) && name !== "README.md" && !name.startsWith(".");
}

/** Document names as the artist would say them: filename without extension. */
export function listReferenceDocs(): string[] {
  try {
    return fs
      .readdirSync(REFERENCE_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isReferenceFile(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function resolveDoc(requested: string): string {
  const docs = listReferenceDocs();
  const wanted = requested.trim().toLowerCase();
  const found =
    docs.find((doc) => doc.toLowerCase() === wanted) ??
    docs.find((doc) => doc.toLowerCase().replace(/\.[^.]+$/, "") === wanted) ??
    docs.find((doc) => doc.toLowerCase().includes(wanted));
  if (!found) {
    throw new Error(
      docs.length
        ? `No reference document matches "${requested}". On the shelf: ${docs.join(", ")}.`
        : `The reference shelf is empty. Documents go in the reference/ folder of the student data directory.`,
    );
  }
  return found;
}

// ---------------------------------------------------------------------------
// Extraction (lazy, cached by mtime+size)
// ---------------------------------------------------------------------------

async function extractText(absolute: string): Promise<string> {
  const ext = path.extname(absolute).toLowerCase();
  const stat = fs.statSync(absolute);
  if (stat.size > MAX_DOC_BYTES) {
    throw new Error(`${path.basename(absolute)} is over ${MAX_DOC_BYTES / 1024 / 1024}MB; split it before shelving.`);
  }

  if (PLAIN_TEXT.has(ext)) return fs.readFileSync(absolute, "utf8");

  const cachePath = path.join(CACHE_DIR, `${path.basename(absolute)}.${stat.mtimeMs}-${stat.size}.txt`);
  if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath, "utf8");

  let text: string;
  if (ext === ".pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: fs.readFileSync(absolute) });
    try {
      text = (await parser.getText()).text ?? "";
    } finally {
      await parser.destroy();
    }
  } else {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ path: absolute });
    text = result.value ?? "";
  }

  if (!text.trim()) {
    throw new Error(
      `Nothing could be extracted from ${path.basename(absolute)}. It may be a scanned image PDF; export it as text first.`,
    );
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // Drop stale cache entries for the same document before writing the new one.
  for (const entry of fs.readdirSync(CACHE_DIR)) {
    if (entry.startsWith(`${path.basename(absolute)}.`)) fs.rmSync(path.join(CACHE_DIR, entry), { force: true });
  }
  fs.writeFileSync(cachePath, text, "utf8");
  return text;
}

// ---------------------------------------------------------------------------
// Sectioning
// ---------------------------------------------------------------------------

type Section = { heading: string; body: string };

/**
 * Markdown splits on headings; extracted PDF text (no reliable headings)
 * splits on paragraph boundaries into roughly TARGET_SECTION_CHARS blocks.
 * Oversized heading sections get subdivided the same way.
 */
function sectionize(text: string): Section[] {
  const lines = text.split("\n");
  const rough: Section[] = [];
  let heading = "(start)";
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body) rough.push({ heading, body });
    buffer = [];
  };

  for (const line of lines) {
    const md = /^#{1,4}\s+(.*)/.exec(line);
    // Extracted manuals often shout their headings; short ALL-CAPS lines are
    // the best structural signal a PDF leaves behind.
    const caps = /^[A-Z][A-Z0-9 ,.'&/-]{3,60}$/.test(line.trim()) && line.trim() === line.trim().toUpperCase();
    if (md || caps) {
      flush();
      heading = md ? md[1].trim() : line.trim();
    }
    buffer.push(line);
  }
  flush();

  const sections: Section[] = [];
  for (const section of rough.length ? rough : [{ heading: "(start)", body: text.trim() }]) {
    if (section.body.length <= MAX_SECTION_CHARS) {
      sections.push(section);
      continue;
    }
    const paragraphs = section.body.split(/\n\s*\n/);
    let chunk: string[] = [];
    let size = 0;
    let part = 1;
    for (const paragraph of paragraphs) {
      if (size + paragraph.length > TARGET_SECTION_CHARS && chunk.length) {
        sections.push({ heading: `${section.heading} (${part})`, body: chunk.join("\n\n") });
        part += 1;
        chunk = [];
        size = 0;
      }
      chunk.push(paragraph);
      size += paragraph.length;
    }
    if (chunk.length) sections.push({ heading: `${section.heading} (${part})`, body: chunk.join("\n\n") });
  }
  return sections;
}

async function loadSections(doc: string): Promise<Section[]> {
  return sectionize(await extractText(path.join(REFERENCE_DIR, doc)));
}

// ---------------------------------------------------------------------------
// Search and read
// ---------------------------------------------------------------------------

function terms(query: string): string[] {
  return Array.from(new Set(query.toLowerCase().split(/[^a-z0-9'#+-]+/i).filter((term) => term.length > 2)));
}

function snippetAround(body: string, needle: string): string {
  const at = body.toLowerCase().indexOf(needle);
  const start = Math.max(0, (at === -1 ? 0 : at) - 120);
  return body.slice(start, start + 340).replace(/\s+/g, " ").trim();
}

export async function searchReference(query: string, docFilter?: string): Promise<ReferenceHit[]> {
  const wanted = terms(query);
  const phrase = query.trim().toLowerCase();
  if (!wanted.length && !phrase) return [];

  const docs = docFilter ? [resolveDoc(docFilter)] : listReferenceDocs();
  const hits: ReferenceHit[] = [];

  for (const doc of docs) {
    const sections = await loadSections(doc);
    sections.forEach((section, index) => {
      const haystack = `${section.heading}\n${section.body}`.toLowerCase();
      let score = 0;
      let firstTerm = "";
      for (const term of wanted) {
        const count = haystack.split(term).length - 1;
        if (count > 0 && !firstTerm) firstTerm = term;
        score += Math.min(count, 5);
      }
      if (phrase.length > 5 && haystack.includes(phrase)) score += 10;
      if (section.heading.toLowerCase().includes(phrase) && phrase.length > 3) score += 6;
      if (score > 0) {
        hits.push({
          doc,
          section: index,
          heading: section.heading,
          snippet: snippetAround(section.body, phrase.length > 5 ? phrase : firstTerm),
          score,
        });
      }
    });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, MAX_HITS);
}

export async function readReferenceSection(
  docRequested: string,
  sectionIndex?: number,
): Promise<{ doc: string; section: number; heading: string; text: string; sectionCount: number }> {
  const doc = resolveDoc(docRequested);
  const sections = await loadSections(doc);
  const index = Math.min(Math.max(sectionIndex ?? 0, 0), sections.length - 1);

  // The neighbouring sections usually carry the sentence that got cut off.
  const parts = [sections[index - 1], sections[index], sections[index + 1]].filter(Boolean) as Section[];
  return {
    doc,
    section: index,
    heading: sections[index].heading,
    text: parts.map((part) => part.body).join("\n\n"),
    sectionCount: sections.length,
  };
}
