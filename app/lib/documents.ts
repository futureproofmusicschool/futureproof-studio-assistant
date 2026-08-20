import "server-only";

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { google, type docs_v1, type drive_v3 } from "googleapis";
import { getAuthorizedGoogleClient } from "@/lib/google/auth";
import { GOOGLE_SCOPES } from "@/lib/google/config";
import {
  pendingDocumentWriteAction,
  type PendingDocumentMarkerState,
} from "@/lib/document-retry";
import {
  connectedGoogleWorkspaceAccountTag,
  ensureStudioFolder,
  STUDIO_ACCOUNT_PROPERTY,
  STUDIO_RESOURCE_PROPERTY,
  STUDIO_RESOURCE_TAGS,
} from "@/lib/google/workspace";
import { dataPath } from "@/lib/paths";
import { usesAgentGoogleConnectors } from "@/lib/connectors/google-runtime";
import {
  deleteConnectorDocument,
  importLegacyDocumentsConnector,
  listConnectorDocuments,
  readConnectorDocument,
  writeConnectorDocument,
} from "@/lib/connectors/google-documents";

const DOCUMENT_MIME_TYPE = "application/vnd.google-apps.document";
const MAX_BODY_CHARS = 400 * 1024;
const EXCERPT_CHARS = 140;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const DOCUMENT_FIELDS =
  "id,name,mimeType,webViewLink,createdTime,modifiedTime,appProperties,parents,trashed";

const SOURCE_PROPERTY = "fsaSource";
const LEGACY_SLUG_PROPERTY = "fsaLegacySlug";
const LEGACY_CREATED_PROPERTY = "fsaLegacyCreated";
const LEGACY_UPDATED_PROPERTY = "fsaLegacyUpdated";
const LEGACY_REVISION_PROPERTY = "fsaLegacyRevision";
const IMPORT_STATE_PROPERTY = "fsaImportState";
const CREATE_OPERATION_PROPERTY = "fsaCreateOperation";
const CREATE_PAYLOAD_PROPERTY = "fsaCreatePayload";
const CREATE_STATE_PROPERTY = "fsaCreateState";
const APPEND_OPERATION_PREFIX = "fsa-append-v1-";
const CREATE_BODY_OPERATION_PREFIX = "fsa-create-body-v1-";
const IMPORT_BODY_OPERATION_PREFIX = "fsa-import-body-v1-";

export type DocumentSource = "assistant" | "you" | "deep-research";
export type WriteMode = "replace" | "append";

export type DocumentSummary = {
  /** Canonical Google Drive file id. */
  id: string;
  /** @deprecated Compatibility alias while older tool callers move to `id`. */
  slug: string;
  title: string;
  source: DocumentSource;
  createdAt: string;
  updatedAt: string;
  excerpt: string;
  webViewLink: string;
};

export type StudioDocument = DocumentSummary & {
  /** Plain readable text extracted from the native Google Doc for preview/model use. */
  body: string;
  revisionId: string | null;
};

export type WriteDocumentInput = {
  title?: string;
  body: string;
  id?: string;
  documentId?: string;
  /** @deprecated Compatibility alias for older callers; contains a Google file id. */
  slug?: string;
  mode?: WriteMode;
  source?: DocumentSource;
  /**
   * Stable caller-generated operation id. Reuse it when retrying a create or
   * append. Supply a distinct value to intentionally repeat identical work.
   */
  operationId?: string;
  /** Required when replacing an existing Doc; obtained from readDocument. */
  expectedRevisionId?: string;
  /** @deprecated Creation is now deduplicated by operation id or payload. */
  createNew?: boolean;
};

export type LegacyDocumentImportResult = {
  imported: Array<{ legacySlug: string; id: string; title: string; webViewLink: string }>;
  skipped: Array<{ legacySlug: string; id: string; title: string; webViewLink: string }>;
  failed: Array<{ legacySlug: string; error: string }>;
};

type TextMark = {
  start: number;
  end: number;
  style: docs_v1.Schema$TextStyle;
  fields: string;
};

type ParagraphMark = {
  start: number;
  end: number;
  namedStyleType: string;
};

type ListMark = {
  start: number;
  end: number;
  type: "bullet" | "number";
  line: number;
};

type RenderedMarkdown = {
  text: string;
  textMarks: TextMark[];
  paragraphMarks: ParagraphMark[];
  listMarks: ListMark[];
};

function isSource(value: unknown): value is DocumentSource {
  return value === "assistant" || value === "you" || value === "deep-research";
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "document"
  );
}

function quoteDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function documentTagQuery(folderId?: string) {
  const accountTag = connectedGoogleWorkspaceAccountTag();
  return [
    "trashed = false",
    `mimeType = '${DOCUMENT_MIME_TYPE}'`,
    `appProperties has { key='${STUDIO_RESOURCE_PROPERTY}' and value='${STUDIO_RESOURCE_TAGS.document}' }`,
    `appProperties has { key='${STUDIO_ACCOUNT_PROPERTY}' and value='${quoteDriveQuery(accountTag)}' }`,
    ...(folderId ? [`'${quoteDriveQuery(folderId)}' in parents`] : []),
  ].join(" and ");
}

export function plainExcerpt(body: string) {
  const line =
    body
      .split("\n")
      .map((part) => part.trim())
      .find((part) => part && !part.startsWith("#") && !part.startsWith("---") && !part.startsWith("|")) ?? "";
  return line.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "").replace(/\s+/g, " ").slice(0, EXCERPT_CHARS);
}

function inlineMarkdown(source: string) {
  const output = { text: "", marks: [] as TextMark[] };
  let remaining = source;
  const candidates: Array<{
    expression: RegExp;
    contentGroup: number;
    style: (match: RegExpExecArray) => Pick<TextMark, "style" | "fields">;
  }> = [
    {
      expression: /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/,
      contentGroup: 1,
      style: (match) => ({ style: { link: { url: match[2] } }, fields: "link" }),
    },
    {
      expression: /\*\*([^*\n]+)\*\*/,
      contentGroup: 1,
      style: () => ({ style: { bold: true }, fields: "bold" }),
    },
    {
      expression: /__([^_\n]+)__/,
      contentGroup: 1,
      style: () => ({ style: { bold: true }, fields: "bold" }),
    },
    {
      expression: /`([^`\n]+)`/,
      contentGroup: 1,
      style: () => ({
        style: { weightedFontFamily: { fontFamily: "Roboto Mono" } },
        fields: "weightedFontFamily",
      }),
    },
    {
      expression: /\*([^*\n]+)\*/,
      contentGroup: 1,
      style: () => ({ style: { italic: true }, fields: "italic" }),
    },
    {
      expression: /_([^_\n]+)_/,
      contentGroup: 1,
      style: () => ({ style: { italic: true }, fields: "italic" }),
    },
  ];

  while (remaining) {
    const matches = candidates
      .map((candidate, priority) => ({ candidate, priority, match: candidate.expression.exec(remaining) }))
      .filter(
        (entry): entry is typeof entry & { match: RegExpExecArray } => Boolean(entry.match),
      )
      .sort((left, right) => left.match.index - right.match.index || left.priority - right.priority);
    const next = matches[0];
    if (!next) {
      output.text += remaining;
      break;
    }

    output.text += remaining.slice(0, next.match.index);
    const content = next.match[next.candidate.contentGroup];
    const start = output.text.length;
    output.text += content;
    const end = output.text.length;
    output.marks.push({ start, end, ...next.candidate.style(next.match) });
    remaining = remaining.slice(next.match.index + next.match[0].length);
  }

  return output;
}

/**
 * Native Docs remain the source of truth. This converter intentionally handles
 * the high-value Markdown subset produced by the assistant: headings, lists,
 * bold/italic/code, blockquotes, and ordinary links. Tables and rarer syntax
 * stay readable as text rather than being guessed into a destructive shape.
 */
export function renderMarkdownForGoogleDocs(markdown: string): RenderedMarkdown {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const rendered: RenderedMarkdown = { text: "", textMarks: [], paragraphMarks: [], listMarks: [] };
  let inCodeBlock = false;

  lines.forEach((original, line) => {
    if (/^\s*```/.test(original)) {
      inCodeBlock = !inCodeBlock;
      return;
    }

    if (rendered.text) rendered.text += "\n";
    const start = rendered.text.length;
    let content = original;
    let namedStyleType: string | null = null;
    let listType: ListMark["type"] | null = null;
    let wholeLineStyle: Pick<TextMark, "style" | "fields"> | null = null;

    const heading = content.match(/^(#{1,6})\s+(.+)$/);
    const unordered = content.match(/^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/);
    const ordered = content.match(/^\s*\d+[.)]\s+(.*)$/);
    const quote = content.match(/^\s*>\s?(.*)$/);

    if (inCodeBlock) {
      wholeLineStyle = {
        style: { weightedFontFamily: { fontFamily: "Roboto Mono" } },
        fields: "weightedFontFamily",
      };
    } else if (heading) {
      content = heading[2];
      const level = Math.min(3, heading[1].length);
      namedStyleType = `HEADING_${level}`;
    } else if (unordered) {
      const checkbox = unordered[1];
      content = checkbox ? `${checkbox.toLowerCase() === "x" ? "☑" : "☐"} ${unordered[2]}` : unordered[2];
      listType = "bullet";
    } else if (ordered) {
      content = ordered[1];
      listType = "number";
    } else if (quote) {
      content = quote[1];
      wholeLineStyle = { style: { italic: true }, fields: "italic" };
    }

    const inline = inCodeBlock ? { text: content, marks: [] as TextMark[] } : inlineMarkdown(content);
    rendered.text += inline.text;
    const end = rendered.text.length;

    for (const mark of inline.marks) {
      rendered.textMarks.push({ ...mark, start: start + mark.start, end: start + mark.end });
    }
    if (wholeLineStyle && end > start) {
      rendered.textMarks.push({ start, end, ...wholeLineStyle });
    }
    if (namedStyleType && end > start) {
      rendered.paragraphMarks.push({ start, end, namedStyleType });
    }
    if (listType && end > start) rendered.listMarks.push({ start, end, type: listType, line });
  });

  // Removing fenced-code marker lines can leave an artificial leading newline.
  const leading = rendered.text.length - rendered.text.replace(/^\n+/, "").length;
  if (leading) {
    rendered.text = rendered.text.slice(leading);
    rendered.textMarks = rendered.textMarks
      .map((mark) => ({ ...mark, start: Math.max(0, mark.start - leading), end: Math.max(0, mark.end - leading) }))
      .filter((mark) => mark.end > mark.start);
    rendered.paragraphMarks = rendered.paragraphMarks
      .map((mark) => ({ ...mark, start: Math.max(0, mark.start - leading), end: Math.max(0, mark.end - leading) }))
      .filter((mark) => mark.end > mark.start);
    rendered.listMarks = rendered.listMarks
      .map((mark) => ({ ...mark, start: Math.max(0, mark.start - leading), end: Math.max(0, mark.end - leading) }))
      .filter((mark) => mark.end > mark.start);
  }
  return rendered;
}

function location(index: number, tabId?: string | null): docs_v1.Schema$Location {
  return { index, ...(tabId ? { tabId } : {}) };
}

function range(startIndex: number, endIndex: number, tabId?: string | null): docs_v1.Schema$Range {
  return { startIndex, endIndex, ...(tabId ? { tabId } : {}) };
}

export function markdownRequests(rendered: RenderedMarkdown, insertionIndex: number, tabId?: string | null) {
  const requests: docs_v1.Schema$Request[] = [];
  if (!rendered.text) return requests;

  requests.push({ insertText: { location: location(insertionIndex, tabId), text: rendered.text } });
  for (const mark of rendered.paragraphMarks) {
    requests.push({
      updateParagraphStyle: {
        range: range(insertionIndex + mark.start, insertionIndex + mark.end, tabId),
        paragraphStyle: { namedStyleType: mark.namedStyleType },
        fields: "namedStyleType",
      },
    });
  }

  const listGroups: Array<Omit<ListMark, "line">> = [];
  for (let index = 0; index < rendered.listMarks.length; index += 1) {
    const mark = rendered.listMarks[index];
    const previous = listGroups[listGroups.length - 1];
    const priorLine = rendered.listMarks[index - 1]?.line;
    if (previous && previous.type === mark.type && priorLine === mark.line - 1) previous.end = mark.end;
    else listGroups.push({ start: mark.start, end: mark.end, type: mark.type });
  }
  for (const mark of listGroups) {
    requests.push({
      createParagraphBullets: {
        range: range(insertionIndex + mark.start, insertionIndex + mark.end, tabId),
        bulletPreset:
          mark.type === "number" ? "NUMBERED_DECIMAL_ALPHA_ROMAN" : "BULLET_DISC_CIRCLE_SQUARE",
      },
    });
  }

  for (const mark of rendered.textMarks) {
    requests.push({
      updateTextStyle: {
        range: range(insertionIndex + mark.start, insertionIndex + mark.end, tabId),
        textStyle: mark.style,
        fields: mark.fields,
      },
    });
  }
  return requests;
}

function paragraphText(paragraph: docs_v1.Schema$Paragraph) {
  return (paragraph.elements ?? [])
    .map((element) => {
      if (element.textRun?.content) return element.textRun.content;
      if (element.dateElement?.dateElementProperties?.displayText) {
        return element.dateElement.dateElementProperties.displayText;
      }
      if (element.person?.personProperties) {
        return element.person.personProperties.name || element.person.personProperties.email || "";
      }
      if (element.richLink?.richLinkProperties) {
        return element.richLink.richLinkProperties.title || element.richLink.richLinkProperties.uri || "";
      }
      if (element.pageBreak) return "\n";
      if (element.inlineObjectElement) return "[Embedded object]";
      return "";
    })
    .join("");
}

function paragraphMarkdown(paragraph: docs_v1.Schema$Paragraph) {
  const raw = paragraphText(paragraph);
  const content = raw.replace(/\n+$/, "");
  const suffix = raw.slice(content.length);
  if (!content) return suffix;

  if (paragraph.bullet) {
    const depth = Math.max(0, paragraph.bullet.nestingLevel ?? 0);
    return `${"  ".repeat(depth)}- ${content}${suffix}`;
  }

  const namedStyle = paragraph.paragraphStyle?.namedStyleType ?? "";
  const heading = namedStyle.match(/^HEADING_([1-6])$/);
  if (heading) return `${"#".repeat(Number(heading[1]))} ${content}${suffix}`;
  if (namedStyle === "TITLE") return `# ${content}${suffix}`;
  if (namedStyle === "SUBTITLE") return `## ${content}${suffix}`;
  return raw;
}

function structuralText(elements: docs_v1.Schema$StructuralElement[]): string {
  return elements
    .map((element) => {
      if (element.paragraph) return paragraphMarkdown(element.paragraph);
      if (element.table) {
        return (element.table.tableRows ?? [])
          .map((row) =>
            (row.tableCells ?? [])
              .map((cell) => structuralText(cell.content ?? []).trim().replace(/\n+/g, " "))
              .join(" | "),
          )
          .join("\n");
      }
      if (element.tableOfContents) return structuralText(element.tableOfContents.content ?? []);
      return "";
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n");
}

function flattenTabs(tabs: docs_v1.Schema$Tab[]): string[] {
  const flattened: string[] = [];
  for (const tab of tabs) {
    const text = structuralText(tab.documentTab?.body?.content ?? []).replace(/\n+$/, "");
    const title = tab.tabProperties?.title?.trim();
    flattened.push(title ? `## ${title}\n\n${text}`.trim() : text);
    flattened.push(...flattenTabs(tab.childTabs ?? []));
  }
  return flattened;
}

export function documentText(document: docs_v1.Schema$Document) {
  const tabs = document.tabs ?? [];
  if (tabs.length > 1 || tabs.some((tab) => (tab.childTabs?.length ?? 0) > 0)) {
    return flattenTabs(tabs).filter(Boolean).join("\n\n").trim();
  }
  const body = tabs[0]?.documentTab?.body ?? document.body;
  return structuralText(body?.content ?? []).replace(/\n+$/, "");
}

function structuralPlainText(elements: docs_v1.Schema$StructuralElement[]): string {
  return elements
    .map((element) => {
      if (element.paragraph) return paragraphText(element.paragraph);
      if (element.table) {
        return (element.table.tableRows ?? [])
          .map((row) =>
            (row.tableCells ?? [])
              .map((cell) => structuralPlainText(cell.content ?? []).trim().replace(/\n+/g, " "))
              .join(" | "),
          )
          .join("\n");
      }
      if (element.tableOfContents) return structuralPlainText(element.tableOfContents.content ?? []);
      return "";
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n");
}

export function documentPlainText(document: docs_v1.Schema$Document) {
  const body = primaryTab(document).body;
  return structuralPlainText(body?.content ?? []).replace(/\n+$/, "");
}

export function primaryTab(document: docs_v1.Schema$Document) {
  const first = document.tabs?.[0];
  return {
    tabId: first?.tabProperties?.tabId,
    body: first?.documentTab?.body ?? document.body,
  };
}

function hasSecondaryTabs(document: docs_v1.Schema$Document) {
  const tabs = document.tabs ?? [];
  return tabs.length > 1 || tabs.some((tab) => (tab.childTabs?.length ?? 0) > 0);
}

export function bodyEndIndex(document: docs_v1.Schema$Document) {
  const content = primaryTab(document).body?.content ?? [];
  return Math.max(1, content[content.length - 1]?.endIndex ?? 1);
}

function tabNamedRangeNames(tabs: docs_v1.Schema$Tab[]): string[] {
  const names: string[] = [];
  for (const tab of tabs) {
    names.push(...Object.keys(tab.documentTab?.namedRanges ?? {}));
    names.push(...tabNamedRangeNames(tab.childTabs ?? []));
  }
  return names;
}

function namedRangeNames(document: docs_v1.Schema$Document) {
  return new Set([
    ...Object.keys(document.namedRanges ?? {}),
    ...tabNamedRangeNames(document.tabs ?? []),
  ]);
}

function sourceFromFile(file: drive_v3.Schema$File): DocumentSource {
  const source = file.appProperties?.[SOURCE_PROPERTY];
  return isSource(source) ? source : "you";
}

function timeFromFile(
  file: drive_v3.Schema$File,
  field: "created" | "updated",
  revisionId?: string | null,
) {
  const legacy =
    field === "created"
      ? file.appProperties?.[LEGACY_CREATED_PROPERTY]
      : file.appProperties?.[LEGACY_UPDATED_PROPERTY];
  if (field === "created" && isIsoDate(legacy)) return legacy;
  if (field === "updated" && isIsoDate(legacy)) {
    const importedRevision = file.appProperties?.[LEGACY_REVISION_PROPERTY];
    if (importedRevision && revisionId && importedRevision === digest(revisionId)) return legacy;

    // Compatibility for an import completed by the first Google-backed build,
    // before revision fingerprints were stored. A later Drive modification is
    // treated as a real Google-side edit and wins over the legacy timestamp.
    if (!importedRevision && file.appProperties?.[IMPORT_STATE_PROPERTY] === "complete") {
      const created = Date.parse(file.createdTime ?? "");
      const modified = Date.parse(file.modifiedTime ?? "");
      if (Number.isFinite(created) && Number.isFinite(modified) && modified - created < 120_000) {
        return legacy;
      }
    }
  }
  const driveTime = field === "created" ? file.createdTime : file.modifiedTime;
  return isIsoDate(driveTime) ? driveTime : new Date().toISOString();
}

function isStudioDocumentFile(file: drive_v3.Schema$File, folderId: string) {
  // Both signals are required. The tag proves the app created/adopted it; the
  // direct parent proves it is still inside the user-visible ownership
  // boundary. Untagged manual children are intentionally ignored. With the
  // narrow drive.file scope they may not even be visible, and silently adopting
  // whichever ones are visible would make behavior depend on OAuth history.
  return (
    !file.trashed &&
    file.mimeType === DOCUMENT_MIME_TYPE &&
    file.appProperties?.[STUDIO_RESOURCE_PROPERTY] === STUDIO_RESOURCE_TAGS.document &&
    file.appProperties?.[STUDIO_ACCOUNT_PROPERTY] === connectedGoogleWorkspaceAccountTag() &&
    Boolean(file.parents?.includes(folderId))
  );
}

function summaryFrom(file: drive_v3.Schema$File, body: string, revisionId?: string | null): DocumentSummary {
  if (!file.id) throw new Error("Google Drive returned a document without an id.");
  if (!file.webViewLink) throw new Error(`Google Drive did not return a link for "${file.name || file.id}".`);
  return {
    id: file.id,
    slug: file.id,
    title: file.name || "Untitled document",
    source: sourceFromFile(file),
    createdAt: timeFromFile(file, "created", revisionId),
    updatedAt: timeFromFile(file, "updated", revisionId),
    excerpt: plainExcerpt(body),
    webViewLink: file.webViewLink,
  };
}

async function googleClients() {
  const auth = await getAuthorizedGoogleClient([GOOGLE_SCOPES.driveFile]);
  return {
    drive: google.drive({ version: "v3", auth }),
    docs: google.docs({ version: "v1", auth }),
  };
}

async function getDriveFile(id: string) {
  if (!DOCUMENT_ID_PATTERN.test(id)) return null;
  const { drive } = await googleClients();
  try {
    const response = await drive.files.get({ fileId: id, fields: DOCUMENT_FIELDS });
    return response.data;
  } catch (error) {
    const status = (error as { code?: unknown; response?: { status?: unknown } }).code ??
      (error as { response?: { status?: unknown } }).response?.status;
    if (status === 404) return null;
    throw error;
  }
}

async function getNativeDocument(id: string) {
  const { docs } = await googleClients();
  const response = await docs.documents.get({ documentId: id, includeTabsContent: true });
  return response.data;
}

async function listDocumentFiles(folderId: string) {
  const { drive } = await googleClients();
  const files: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const response = await drive.files.list({
      q: documentTagQuery(folderId),
      spaces: "drive",
      pageSize: 100,
      pageToken,
      orderBy: "modifiedTime desc",
      fields: `nextPageToken,files(${DOCUMENT_FIELDS})`,
    });
    files.push(...(response.data.files ?? []));
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  return files;
}

async function mapLimited<T, R>(values: T[], limit: number, mapper: (value: T) => Promise<R>) {
  const output: R[] = new Array(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      output[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  if (usesAgentGoogleConnectors()) return listConnectorDocuments();
  const folder = await ensureStudioFolder();
  const files = await listDocumentFiles(folder.folderId);
  const documents = await mapLimited(files, 5, async (file) => {
    if (!file.id) return null;
    try {
      const native = await getNativeDocument(file.id);
      return summaryFrom(file, documentText(native), native.revisionId);
    } catch {
      // Keep a Drive-visible file in the list even when Docs preview retrieval
      // fails transiently. Opening it will surface the specific error.
      return summaryFrom(file, "");
    }
  });
  return documents
    .filter((document): document is DocumentSummary => Boolean(document))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function readDocument(id: string): Promise<StudioDocument | null> {
  if (usesAgentGoogleConnectors()) return readConnectorDocument(id);
  const folder = await ensureStudioFolder();
  const file = await getDriveFile(id.trim());
  if (!file || !isStudioDocumentFile(file, folder.folderId)) return null;
  const native = await getNativeDocument(id.trim());
  const body = documentText(native);
  return {
    ...summaryFrom(file, body, native.revisionId),
    body,
    revisionId: native.revisionId ?? null,
  };
}

export async function documentExists(id: string) {
  return Boolean(await readDocument(id));
}

function appendPrefix(existing: string, addition: string) {
  if (!existing.trim()) return "";
  const last = existing.trimEnd().split("\n").pop()?.trim() ?? "";
  const first = addition.trimStart().split("\n")[0]?.trim() ?? "";
  const block = (line: string) => {
    if (/^[-*+] /.test(line)) return "bullet";
    if (/^\d+[.)] /.test(line)) return "number";
    if (line.startsWith("|")) return "table";
    return null;
  };
  const kind = block(last);
  return kind && kind === block(first) ? "\n" : "\n\n";
}

type OperationMarker = { name: string; prefix: string };
class PendingDocumentConflictError extends Error {}

type WriteNativeOptions = {
  appendOperation?: OperationMarker;
  expectedRevisionId?: string;
  replaceRecovery?: {
    operation: OperationMarker;
    allowBlankWrite: boolean;
    conflictMessage: string;
    currentTitle: string;
    intendedTitle: string;
  };
};

function operationMarkerState(
  names: ReadonlySet<string>,
  operation: OperationMarker,
): PendingDocumentMarkerState {
  if (names.has(operation.name)) return "match";
  if (Array.from(names).some((name) => name.startsWith(operation.prefix))) return "conflict";
  return "absent";
}

function replacementRecoveryAction(
  document: docs_v1.Schema$Document,
  renderedText: string,
  recovery: NonNullable<WriteNativeOptions["replaceRecovery"]>,
  allowBlankWrite = recovery.allowBlankWrite,
) {
  return pendingDocumentWriteAction({
    marker: operationMarkerState(namedRangeNames(document), recovery.operation),
    currentPlainText: documentPlainText(document),
    intendedPlainText: renderedText,
    allowBlankWrite,
    currentTitle: recovery.currentTitle,
    intendedTitle: recovery.intendedTitle,
  });
}

async function writeNativeContent(
  id: string,
  markdown: string,
  mode: WriteMode,
  options: WriteNativeOptions = {},
) {
  if (markdown.length > MAX_BODY_CHARS) throw new Error("That document is too large to save.");
  const { docs } = await googleClients();
  const fresh = await getNativeDocument(id);
  if (mode === "replace" && hasSecondaryTabs(fresh)) {
    throw new Error(
      "Studio Assistant will not replace a multi-tab Google Doc. Edit it in Google Docs or append instead.",
    );
  }
  if (
    mode === "replace" &&
    options.expectedRevisionId &&
    fresh.revisionId !== options.expectedRevisionId
  ) {
    throw new Error(
      "That Google Doc changed after it was read. Read the latest revision before replacing it.",
    );
  }
  const names = namedRangeNames(fresh);
  if (options.appendOperation) {
    if (names.has(options.appendOperation.name)) return fresh;
    if (Array.from(names).some((name) => name.startsWith(options.appendOperation?.prefix ?? ""))) {
      throw new Error("That document operation id was already used for different append content.");
    }
  }
  const { tabId } = primaryTab(fresh);
  const endIndex = bodyEndIndex(fresh);
  const insertionIndex = mode === "append" ? Math.max(1, endIndex - 1) : 1;
  const prefix = mode === "append" ? appendPrefix(documentText(fresh), markdown) : "";
  const rendered = renderMarkdownForGoogleDocs(`${prefix}${markdown.trim()}`);
  if (options.replaceRecovery) {
    const action = replacementRecoveryAction(fresh, rendered.text, options.replaceRecovery);
    if (action === "complete") return fresh;
    if (action === "conflict") {
      throw new PendingDocumentConflictError(options.replaceRecovery.conflictMessage);
    }
  }
  const requests: docs_v1.Schema$Request[] = [];

  if (mode === "replace" && endIndex > 2) {
    requests.push({
      deleteContentRange: {
        range: range(1, endIndex - 1, tabId),
      },
    });
  }
  requests.push(...markdownRequests(rendered, insertionIndex, tabId));
  if (options.appendOperation && rendered.text) {
    requests.push({
      createNamedRange: {
        name: options.appendOperation.name,
        range: range(insertionIndex, insertionIndex + rendered.text.length, tabId),
      },
    });
  }
  if (options.replaceRecovery && rendered.text) {
    requests.push({
      createNamedRange: {
        name: options.replaceRecovery.operation.name,
        range: range(insertionIndex, insertionIndex + rendered.text.length, tabId),
      },
    });
  }
  if (!requests.length) return fresh;

  try {
    await docs.documents.batchUpdate({
      documentId: id,
      requestBody: {
        requests,
        ...((options.expectedRevisionId ?? fresh.revisionId)
          ? { writeControl: { requiredRevisionId: options.expectedRevisionId ?? fresh.revisionId } }
          : {}),
      },
    });
  } catch (error) {
    // A lost HTTP response is ambiguous: Google may have committed the atomic
    // batch. The named range is written in that same batch, so it is a durable
    // completion marker that lets us recover without appending twice.
    if (options.appendOperation) {
      try {
        const recovered = await getNativeDocument(id);
        if (namedRangeNames(recovered).has(options.appendOperation.name)) return recovered;
      } catch {
        // Preserve the original write error; a later retry can inspect the same
        // durable marker once Google is reachable again.
      }
    }
    if (options.replaceRecovery) {
      try {
        const recovered = await getNativeDocument(id);
        const action = replacementRecoveryAction(
          recovered,
          rendered.text,
          options.replaceRecovery,
          false,
        );
        if (action === "complete") return recovered;
        if (action === "conflict") {
          throw new PendingDocumentConflictError(options.replaceRecovery.conflictMessage);
        }
      } catch (recoveryError) {
        if (recoveryError instanceof PendingDocumentConflictError) throw recoveryError;
        // Preserve the original batch error when recovery itself is offline.
      }
    }
    throw error;
  }
  return getNativeDocument(id);
}

async function updateDriveMetadata(
  file: drive_v3.Schema$File,
  update: { title?: string; source?: DocumentSource; appProperties?: Record<string, string> },
) {
  if (!file.id) throw new Error("Google Drive returned a document without an id.");
  const { drive } = await googleClients();
  const title = update.title?.trim();
  const appProperties = {
    ...(file.appProperties ?? {}),
    [STUDIO_RESOURCE_PROPERTY]: STUDIO_RESOURCE_TAGS.document,
    [STUDIO_ACCOUNT_PROPERTY]: connectedGoogleWorkspaceAccountTag(),
    ...(update.source ? { [SOURCE_PROPERTY]: update.source } : {}),
    ...(update.appProperties ?? {}),
  };
  await drive.files.update({
    fileId: file.id,
    requestBody: {
      ...(title ? { name: title } : {}),
      appProperties,
    },
    fields: DOCUMENT_FIELDS,
  });
}

async function createNativeDocument(input: {
  title: string;
  source: DocumentSource;
  folderId?: string;
  appProperties?: Record<string, string>;
}) {
  const folderId = input.folderId ?? (await ensureStudioFolder()).folderId;
  const { drive } = await googleClients();
  const response = await drive.files.create({
    requestBody: {
      name: input.title,
      mimeType: DOCUMENT_MIME_TYPE,
      parents: [folderId],
      appProperties: {
        [STUDIO_RESOURCE_PROPERTY]: STUDIO_RESOURCE_TAGS.document,
        [STUDIO_ACCOUNT_PROPERTY]: connectedGoogleWorkspaceAccountTag(),
        [SOURCE_PROPERTY]: input.source,
        ...(input.appProperties ?? {}),
      },
    },
    fields: DOCUMENT_FIELDS,
  });
  if (!response.data.id) throw new Error("Google Drive did not return an id for the new document.");
  return response.data;
}

function createPayloadDigest(input: { title: string; body: string; source: DocumentSource }) {
  return digest(JSON.stringify(input));
}

function createOperationDigest(operationId: string | undefined, payloadDigest: string) {
  const explicit = operationId?.trim();
  return digest(explicit ? `explicit:${explicit}` : `implicit:${payloadDigest}`);
}

function appendOperationMarker(input: {
  documentId: string;
  operationId?: string;
  title?: string;
  body: string;
  source: DocumentSource;
}): OperationMarker {
  const payload = digest(
    JSON.stringify({ title: input.title?.trim() || null, body: input.body, source: input.source }),
  );
  const explicit = input.operationId?.trim();
  const operation = digest(
    explicit
      ? `explicit:${input.documentId}:${explicit}`
      : `implicit:${input.documentId}:${payload}`,
  );
  const prefix = `${APPEND_OPERATION_PREFIX}${operation}-`;
  return { prefix, name: `${prefix}${payload}` };
}

function replaceOperationMarker(prefix: string, operation: string, payload: string): OperationMarker {
  const operationPrefix = `${prefix}${operation}-`;
  return { prefix: operationPrefix, name: `${operationPrefix}${payload}` };
}

async function findCreateOperation(folderId: string, operation: string) {
  const { drive } = await googleClients();
  const response = await drive.files.list({
    q: [
      documentTagQuery(),
      `appProperties has { key='${CREATE_OPERATION_PROPERTY}' and value='${quoteDriveQuery(operation)}' }`,
    ].join(" and "),
    spaces: "drive",
    pageSize: 10,
    orderBy: "createdTime asc",
    fields: `files(${DOCUMENT_FIELDS})`,
  });
  const files = response.data.files ?? [];
  return files.find((file) => file.id && file.parents?.includes(folderId)) ??
    files.find((file) => file.id) ??
    null;
}

async function createDocumentIdempotently(input: {
  title: string;
  body: string;
  source: DocumentSource;
  operation: string;
  payload: string;
  folderId: string;
}) {
  let file = await findCreateOperation(input.folderId, input.operation);
  let createdForThisAttempt = false;
  if (!file) {
    try {
      file = await createNativeDocument({
        title: input.title,
        source: input.source,
        folderId: input.folderId,
        appProperties: {
          [CREATE_OPERATION_PROPERTY]: input.operation,
          [CREATE_PAYLOAD_PROPERTY]: input.payload,
          [CREATE_STATE_PROPERTY]: "pending",
        },
      });
      createdForThisAttempt = true;
    } catch (error) {
      // Drive may have committed a create even when its HTTP response was lost.
      // The operation property is part of the create itself, so a later lookup
      // recovers that exact file instead of producing a sibling duplicate.
      file = await findCreateOperation(input.folderId, input.operation);
      if (!file) throw error;
      createdForThisAttempt = true;
    }
  }

  if (!isStudioDocumentFile(file, input.folderId)) {
    throw new Error("The recovered Google document is outside the Studio Assistant folder.");
  }
  if (file.appProperties?.[CREATE_PAYLOAD_PROPERTY] !== input.payload) {
    throw new Error("That document operation id was already used with different content.");
  }

  if (file.appProperties?.[CREATE_STATE_PROPERTY] !== "complete") {
    if (!file.id) throw new Error("Google Drive did not return an id for the new document.");
    await writeNativeContent(file.id, input.body, "replace", {
      replaceRecovery: {
        operation: replaceOperationMarker(
          CREATE_BODY_OPERATION_PREFIX,
          input.operation,
          input.payload,
        ),
        allowBlankWrite: createdForThisAttempt,
        currentTitle: file.name ?? "",
        intendedTitle: input.title,
        conflictMessage:
          "The pending Google Doc changed after Studio Assistant wrote it. It was left untouched; review it in Google Docs before starting a new save operation.",
      },
    });
    await updateDriveMetadata(file, {
      title: input.title,
      source: input.source,
      appProperties: { [CREATE_STATE_PROPERTY]: "complete" },
    });
  }

  if (!file.id) throw new Error("Google Drive did not return an id for the new document.");
  const saved = await readDocument(file.id);
  if (!saved) throw new Error("The new Google document could not be read back.");
  return saved;
}

const createOperationsInFlight = new Map<string, Promise<StudioDocument>>();

export async function writeDocument(input: WriteDocumentInput): Promise<StudioDocument> {
  if (usesAgentGoogleConnectors()) return writeConnectorDocument(input);
  const body = typeof input.body === "string" ? input.body : "";
  if (body.length > MAX_BODY_CHARS) throw new Error("That document is too large to save.");
  const requestedId = (input.id ?? input.documentId ?? input.slug ?? "").trim();
  const mode: WriteMode = input.mode === "append" ? "append" : "replace";

  if (requestedId && !input.createNew) {
    const folder = await ensureStudioFolder();
    const existingFile = await getDriveFile(requestedId);
    if (!existingFile) throw new Error(`No Google document with id "${requestedId}".`);
    if (!isStudioDocumentFile(existingFile, folder.folderId)) {
      throw new Error("That Google document is not managed by Studio Assistant.");
    }
    if (mode === "replace" && !input.expectedRevisionId?.trim()) {
      throw new Error(
        "Replacing a Google Doc requires the revision id from a fresh read, so newer human edits are not overwritten.",
      );
    }
    if (mode === "append" && !body.trim()) throw new Error("There is nothing to append.");
    const source = input.source ?? sourceFromFile(existingFile);
    const marker =
      mode === "append"
        ? appendOperationMarker({
            documentId: requestedId,
            operationId: input.operationId,
            title: input.title,
            body,
            source,
          })
        : undefined;
    await writeNativeContent(
      requestedId,
      body,
      mode,
      {
        appendOperation: marker,
        expectedRevisionId:
          mode === "replace" ? input.expectedRevisionId?.trim() : undefined,
      },
    );
    await updateDriveMetadata(existingFile, {
      title: input.title,
      source,
    });
    const saved = await readDocument(requestedId);
    if (!saved) throw new Error("The Google document could not be read back after saving.");
    return saved;
  }

  const title = (input.title ?? "").trim();
  if (!title) throw new Error("A document needs a title.");
  const source = input.source ?? "assistant";
  const payload = createPayloadDigest({ title, body, source });
  const operation = createOperationDigest(input.operationId, payload);
  const folder = await ensureStudioFolder();
  const inFlightKey = `${folder.folderId}:${operation}`;
  const existingOperation = createOperationsInFlight.get(inFlightKey);
  if (existingOperation) return existingOperation;

  const pending = createDocumentIdempotently({
    title,
    body,
    source,
    operation,
    payload,
    folderId: folder.folderId,
  });
  createOperationsInFlight.set(inFlightKey, pending);
  try {
    return await pending;
  } finally {
    if (createOperationsInFlight.get(inFlightKey) === pending) {
      createOperationsInFlight.delete(inFlightKey);
    }
  }
}

export async function deleteDocument(id: string) {
  if (usesAgentGoogleConnectors()) return deleteConnectorDocument(id);
  const folder = await ensureStudioFolder();
  const file = await getDriveFile(id.trim());
  if (!file || !isStudioDocumentFile(file, folder.folderId)) return false;
  const { drive } = await googleClients();
  await drive.files.update({ fileId: id.trim(), requestBody: { trashed: true } });
  return true;
}

type LegacyDocument = {
  slug: string;
  title: string;
  source: DocumentSource;
  createdAt: string;
  updatedAt: string;
  body: string;
};

function parseLegacyDocument(filePath: string): LegacyDocument {
  const slug = path.basename(filePath, ".md");
  const raw = fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
  const stats = fs.statSync(filePath);
  let title = slug;
  let source: DocumentSource = "assistant";
  let createdAt = stats.birthtime.toISOString();
  let updatedAt = stats.mtime.toISOString();
  let body = raw;

  if (raw.startsWith("---\n")) {
    const end = raw.indexOf("\n---", 3);
    if (end !== -1) {
      for (const line of raw.slice(4, end).split("\n")) {
        const separator = line.indexOf(":");
        if (separator === -1) continue;
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (key === "title" && value) title = value;
        if (key === "source" && isSource(value)) source = value;
        if (key === "created" && isIsoDate(value)) createdAt = value;
        if (key === "updated" && isIsoDate(value)) updatedAt = value;
      }
      body = raw.slice(end + 4).replace(/^\n+/, "");
    }
  }
  return { slug, title, source, createdAt, updatedAt, body };
}

async function findLegacyImport(folderId: string, legacySlug: string) {
  const { drive } = await googleClients();
  const response = await drive.files.list({
    q: [
      documentTagQuery(),
      `appProperties has { key='${LEGACY_SLUG_PROPERTY}' and value='${quoteDriveQuery(legacySlug)}' }`,
    ].join(" and "),
    spaces: "drive",
    pageSize: 10,
    orderBy: "createdTime asc",
    fields: `files(${DOCUMENT_FIELDS})`,
  });
  const files = response.data.files ?? [];
  return files.find((file) => file.id && file.parents?.includes(folderId)) ??
    files.find((file) => file.id) ??
    null;
}

/**
 * Explicit one-time migration helper. It never deletes or rewrites local files.
 * A pending marker lets an interrupted import resume the same native document
 * instead of duplicating it on the next attempt.
 */
export async function importLegacyDocuments(
  prior?: LegacyDocumentImportResult | null,
): Promise<LegacyDocumentImportResult> {
  if (usesAgentGoogleConnectors()) return importLegacyDocumentsConnector(prior);
  const result: LegacyDocumentImportResult = { imported: [], skipped: [], failed: [] };
  const previouslyCompleted = new Map(
    [...(prior?.imported ?? []), ...(prior?.skipped ?? [])]
      .map((document) => [document.legacySlug, document] as const),
  );
  const directory = dataPath("documents");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
    throw error;
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (!files.length) return result;
  const folder = await ensureStudioFolder();

  for (const entry of files) {
    const legacySlug = entry.name.slice(0, -3);
    const completed = previouslyCompleted.get(legacySlug);
    if (completed) {
      // A retry of a partially failed migration must not recreate a Doc the
      // artist intentionally trashed after this slug already succeeded.
      result.skipped.push(completed);
      continue;
    }
    try {
      const legacy = parseLegacyDocument(path.join(directory, entry.name));
      const importOperation = digest(`legacy-import:${legacy.slug}`);
      const importPayload = digest(JSON.stringify(legacy));
      let remote = await findLegacyImport(folder.folderId, legacy.slug);
      let createdForThisAttempt = false;
      if (remote && !isStudioDocumentFile(remote, folder.folderId)) {
        throw new Error(
          "The previously imported Google document was moved outside the Studio Assistant folder; it was left unchanged.",
        );
      }
      if (remote?.id && remote.appProperties?.[IMPORT_STATE_PROPERTY] === "complete") {
        const document = await readDocument(remote.id);
        if (!document) throw new Error("The existing imported Google document could not be read.");
        result.skipped.push({
          legacySlug,
          id: document.id,
          title: document.title,
          webViewLink: document.webViewLink,
        });
        continue;
      }

      if (!remote) {
        try {
          remote = await createNativeDocument({
            title: legacy.title,
            source: legacy.source,
            folderId: folder.folderId,
            appProperties: {
              [LEGACY_SLUG_PROPERTY]: legacy.slug,
              [LEGACY_CREATED_PROPERTY]: legacy.createdAt,
              [LEGACY_UPDATED_PROPERTY]: legacy.updatedAt,
              [IMPORT_STATE_PROPERTY]: "pending",
            },
          });
          createdForThisAttempt = true;
        } catch (error) {
          // The create request itself is recoverable by the legacy slug. No
          // body write preceded it in this invocation, so a still-blank file
          // recovered here may safely receive its initial content.
          remote = await findLegacyImport(folder.folderId, legacy.slug);
          if (!remote) throw error;
          createdForThisAttempt = true;
        }
      }
      if (!remote.id) throw new Error("Google Drive did not return an id for the imported document.");

      const native = await writeNativeContent(remote.id, legacy.body, "replace", {
        replaceRecovery: {
          operation: replaceOperationMarker(
            IMPORT_BODY_OPERATION_PREFIX,
            importOperation,
            importPayload,
          ),
          allowBlankWrite: createdForThisAttempt,
          currentTitle: remote.name ?? "",
          intendedTitle: legacy.title,
          conflictMessage:
            `The pending import for "${legacy.title}" differs from the current Google Doc. It was left untouched; review the Google Doc before retrying.`,
        },
      });
      await updateDriveMetadata(remote, {
        title: legacy.title,
        source: legacy.source,
        appProperties: {
          [LEGACY_SLUG_PROPERTY]: legacy.slug,
          [LEGACY_CREATED_PROPERTY]: legacy.createdAt,
          [LEGACY_UPDATED_PROPERTY]: legacy.updatedAt,
          ...(native.revisionId
            ? { [LEGACY_REVISION_PROPERTY]: digest(native.revisionId) }
            : {}),
          [IMPORT_STATE_PROPERTY]: "complete",
        },
      });
      const document = await readDocument(remote.id);
      if (!document) throw new Error("The imported Google document could not be verified.");
      result.imported.push({
        legacySlug,
        id: document.id,
        title: document.title,
        webViewLink: document.webViewLink,
      });
    } catch (error) {
      result.failed.push({
        legacySlug,
        error: error instanceof Error ? error.message : "The document could not be imported.",
      });
    }
  }
  return result;
}
