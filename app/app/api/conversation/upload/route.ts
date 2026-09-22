import crypto from "node:crypto";
import { extractPdf } from "@/lib/pdf-text";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { UPLOADS_DIR, appendTurn, type AttachmentKind } from "@/lib/conversation-store";
import { describeMidi } from "@/lib/midi/upload-analysis";
import { timestampForFilename } from "@/lib/talk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Files into the conversation: images, PDFs, text, and MIDI.
 *
 * Everything that is not an image becomes text before it reaches a model,
 * because Live has no document channel and MIDI is not something Gemini reads
 * as a blob. The derived summary is stored with the turn, so the file keeps
 * making sense ten turns later without re-reading the bytes.
 */

const KINDS: { kind: AttachmentKind; extensions: string[]; maxBytes: number }[] = [
  { kind: "image", extensions: [".png", ".jpg", ".jpeg", ".webp", ".gif"], maxBytes: 10 * 1024 * 1024 },
  { kind: "pdf", extensions: [".pdf"], maxBytes: 10 * 1024 * 1024 },
  { kind: "text", extensions: [".txt", ".md", ".csv", ".json"], maxBytes: 200 * 1024 },
  { kind: "midi", extensions: [".mid", ".midi"], maxBytes: 1024 * 1024 },
];

const MIME_FOR_IMAGE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const PDF_SUMMARY_CHARS = 8000;
const TEXT_SUMMARY_CHARS = 8000;

function classify(name: string) {
  const extension = path.extname(name).toLowerCase();
  const match = KINDS.find((entry) => entry.extensions.includes(extension));
  return match ? { ...match, extension } : null;
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "file"
  );
}

async function describePdf(bytes: Uint8Array) {
  const parsed = await extractPdf(bytes);
  const text = (parsed.text ?? "").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return "The PDF has no extractable text (it may be scanned images).";
  const header = parsed.pages ? `PDF, ${parsed.pages} page${parsed.pages === 1 ? "" : "s"}.\n\n` : "";
  return `${header}${text.slice(0, PDF_SUMMARY_CHARS)}${text.length > PDF_SUMMARY_CHARS ? "\n\n[truncated]" : ""}`;
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  }

  const note = typeof form.get("note") === "string" ? String(form.get("note")).trim() : "";
  const forLiveCall = form.get("context") === "live";

  const kind = classify(file.name);
  if (!kind) {
    return NextResponse.json(
      {
        error: `${path.extname(file.name) || "That file type"} is not supported. Images, PDFs, text files, and MIDI files work.`,
      },
      { status: 400 },
    );
  }
  if (file.size > kind.maxBytes) {
    return NextResponse.json(
      { error: `That ${kind.kind} file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${kind.maxBytes / 1024 / 1024} MB.` },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  let summary: string | undefined;
  try {
    if (kind.kind === "midi") summary = describeMidi(bytes);
    else if (kind.kind === "pdf") summary = await describePdf(bytes);
    else if (kind.kind === "text") {
      const text = Buffer.from(bytes).toString("utf8");
      summary = `${text.slice(0, TEXT_SUMMARY_CHARS)}${text.length > TEXT_SUMMARY_CHARS ? "\n\n[truncated]" : ""}`;
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read that file." },
      { status: 400 },
    );
  }

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const filename = `${timestampForFilename(new Date())}-${slugify(file.name)}-${crypto.randomUUID()}${kind.extension}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), bytes);

  const mimeType = kind.kind === "image" ? MIME_FOR_IMAGE[kind.extension] : file.type || "application/octet-stream";

  const turn = appendTurn({
    role: "user",
    mode: forLiveCall ? "voice" : "text",
    text: note || `Shared ${file.name}`,
    attachment: {
      kind: kind.kind,
      name: file.name,
      mimeType,
      path: `conversation/uploads/${filename}`,
      size: file.size,
      ...(summary ? { summary } : {}),
    },
  });

  // A call can take a still image on the video channel; everything else has to
  // arrive already turned into words.
  const live = forLiveCall
    ? kind.kind === "image"
      ? { liveImage: { mimeType, data: Buffer.from(bytes).toString("base64") } }
      : {
          liveText: `[The artist shared ${file.name}]${note ? ` They said: ${note}` : ""}\n\n${summary ?? ""}`.trim(),
        }
    : {};

  return NextResponse.json({ turn, ...live });
}
