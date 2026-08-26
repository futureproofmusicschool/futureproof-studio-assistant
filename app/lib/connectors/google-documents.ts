import "server-only";

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { docs_v1 } from "googleapis";
import type {
  DocumentSource,
  DocumentSummary,
  LegacyDocumentImportResult,
  StudioDocument,
  WriteDocumentInput,
  WriteMode,
} from "@/lib/documents";
import {
  bodyEndIndex,
  documentPlainText,
  documentText,
  markdownRequests,
  plainExcerpt,
  primaryTab,
  renderMarkdownForGoogleDocs,
} from "@/lib/documents";
import { callGoogleConnectorTool } from "@/lib/connectors/google-runtime";
import {
  connectorCreatedFile,
  connectorDriveFiles,
  documentUrl,
  ensureConnectorWorkspace,
} from "@/lib/connectors/google-workspace";
import { isRecord, unwrapConnectorResult, walkRecords } from "@/lib/connectors/result";
import {
  readConnectorHostState,
  updateConnectorHostState,
  type AgentConnectorHost,
  type ConnectorDocumentRecord,
} from "@/lib/connectors/state";
import { dataPath } from "@/lib/paths";

const DOCUMENT_MIME_TYPE = "application/vnd.google-apps.document";
const MAX_BODY_CHARS = 400 * 1024;
const EXCERPT_CHARS = 140;

let documentMutationTail: Promise<unknown> = Promise.resolve();

function queueDocumentMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = documentMutationTail.then(operation, operation);
  documentMutationTail = next.then(() => undefined, () => undefined);
  return next;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function source(value: unknown): DocumentSource {
  return value === "assistant" || value === "deep-research" || value === "you" ? value : "you";
}

function iso(value: string | null | undefined, fallback = new Date().toISOString()) {
  return value && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

function nativeDocument(value: unknown): docs_v1.Schema$Document {
  const unwrapped = unwrapConnectorResult(value);
  if (isRecord(unwrapped)) {
    if (isRecord(unwrapped.document)) return unwrapped.document as docs_v1.Schema$Document;
    if ("documentId" in unwrapped || "body" in unwrapped || "tabs" in unwrapped) {
      return unwrapped as docs_v1.Schema$Document;
    }
  }
  const record = walkRecords(unwrapped).find((candidate) =>
    "documentId" in candidate && ("body" in candidate || "tabs" in candidate));
  if (!record) throw new Error("The Google Drive connector did not return the requested document.");
  return record as docs_v1.Schema$Document;
}

function recordFor(host: AgentConnectorHost, id: string) {
  return readConnectorHostState(host).documents[id];
}

function saveRecord(host: AgentConnectorHost, record: ConnectorDocumentRecord) {
  updateConnectorHostState(host, (current) => ({
    ...current,
    documents: { ...current.documents, [record.id]: record },
    ...(record.operationId
      ? { documentOperations: { ...current.documentOperations, [record.operationId]: record.id } }
      : {}),
  }));
}

function saveOperation(host: AgentConnectorHost, operationId: string, value: string) {
  updateConnectorHostState(host, (current) => ({
    ...current,
    documentOperations: { ...current.documentOperations, [operationId]: value },
  }));
}

async function listManagedFiles(host: AgentConnectorHost, folderUrl: string) {
  const result = await callGoogleConnectorTool(host, "drive", "google_drive_list_folder", {
    url: folderUrl,
    top_k: 1000,
  });
  return connectorDriveFiles(result).filter((file) => file.mimeType === DOCUMENT_MIME_TYPE);
}

async function documentResource(host: AgentConnectorHost, id: string) {
  const result = await callGoogleConnectorTool(host, "drive", "google_drive_get_document", {
    document_id: id,
  });
  return nativeDocument(result);
}

async function nativePlainBodyMatches(host: AgentConnectorHost, id: string, markdown: string) {
  const native = await documentResource(host, id);
  return documentPlainText(native).trimEnd() === renderMarkdownForGoogleDocs(markdown).text.trimEnd();
}

async function readByFile(
  host: AgentConnectorHost,
  file: ReturnType<typeof connectorDriveFiles>[number],
): Promise<StudioDocument> {
  const native = await documentResource(host, file.id);
  const body = documentText(native);
  const stored = recordFor(host, file.id);
  const createdAt = iso(file.createdTime, stored?.createdAt);
  const updatedAt = iso(file.modifiedTime, stored?.updatedAt ?? createdAt);
  return {
    id: file.id,
    slug: file.id,
    title: file.name || native.title || "Untitled document",
    source: source(stored?.source),
    createdAt,
    updatedAt,
    excerpt: plainExcerpt(body).slice(0, EXCERPT_CHARS),
    webViewLink: file.webViewLink ?? documentUrl(file.id),
    body,
    revisionId: typeof native.revisionId === "string" ? native.revisionId : null,
  };
}

export async function listConnectorDocuments(options: { includeExcerpts?: boolean } = {}): Promise<DocumentSummary[]> {
  const { host, workspace } = await ensureConnectorWorkspace();
  const files = await listManagedFiles(host, workspace.folderUrl);
  if (options.includeExcerpts === false) {
    return files
      .map((file) => {
        const stored = recordFor(host, file.id);
        const createdAt = iso(file.createdTime, stored?.createdAt);
        return {
          id: file.id,
          slug: file.id,
          title: file.name,
          source: source(stored?.source),
          createdAt,
          updatedAt: iso(file.modifiedTime, stored?.updatedAt ?? createdAt),
          excerpt: "",
          webViewLink: file.webViewLink ?? documentUrl(file.id),
        } satisfies DocumentSummary;
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  const documents: StudioDocument[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(4, files.length) }, async () => {
    while (next < files.length) {
      const index = next++;
      try {
        documents.push(await readByFile(host, files[index]));
      } catch {
        const file = files[index];
        const stored = recordFor(host, file.id);
        const createdAt = iso(file.createdTime, stored?.createdAt);
        documents.push({
          id: file.id,
          slug: file.id,
          title: file.name,
          source: source(stored?.source),
          createdAt,
          updatedAt: iso(file.modifiedTime, stored?.updatedAt ?? createdAt),
          excerpt: "",
          webViewLink: file.webViewLink ?? documentUrl(file.id),
          body: "",
          revisionId: null,
        });
      }
    }
  });
  await Promise.all(workers);
  return documents
    .map(({ body: _body, revisionId: _revisionId, ...summary }) => summary)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function readConnectorDocument(id: string): Promise<StudioDocument | null> {
  const normalized = id.trim();
  if (!normalized) return null;
  const { host, workspace } = await ensureConnectorWorkspace();
  const file = (await listManagedFiles(host, workspace.folderUrl)).find((entry) => entry.id === normalized);
  return file ? readByFile(host, file) : null;
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

function contentRequests(
  current: docs_v1.Schema$Document,
  body: string,
  mode: WriteMode,
) {
  const tabId = primaryTab(current).tabId;
  const endIndex = bodyEndIndex(current);
  if (mode === "append") {
    const existing = documentText(current);
    const addition = `${appendPrefix(existing, body)}${body}`;
    return markdownRequests(renderMarkdownForGoogleDocs(addition), Math.max(1, endIndex - 1), tabId);
  }
  return [
    ...(endIndex > 2
      ? [{ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1, ...(tabId ? { tabId } : {}) } } }]
      : []),
    ...markdownRequests(renderMarkdownForGoogleDocs(body), 1, tabId),
  ];
}

async function moveNewFile(
  host: AgentConnectorHost,
  file: ReturnType<typeof connectorCreatedFile>,
  folderId: string,
) {
  let parents = file.parents;
  try {
    const metadata = await callGoogleConnectorTool(host, "drive", "google_drive_get_file_metadata", {
      fileId: file.id,
      fields: "id,name,mimeType,webViewLink,createdTime,modifiedTime,parents",
    });
    parents = connectorDriveFiles(metadata)[0]?.parents ?? parents;
  } catch {
    // Adding the dedicated folder is still safe if parent metadata is absent.
  }
  await callGoogleConnectorTool(host, "drive", "google_drive_update_file", {
    fileId: file.id,
    addParents: folderId,
    ...(parents.length ? { removeParents: parents.join(",") } : {}),
  });
}

async function updateDocumentContent(
  host: AgentConnectorHost,
  id: string,
  body: string,
  mode: WriteMode,
  expectedRevisionId?: string,
) {
  const current = await documentResource(host, id);
  if (mode === "replace" && expectedRevisionId && current.revisionId !== expectedRevisionId) {
    throw new Error("This Google Doc changed after it was read. Refresh it before replacing its contents.");
  }
  const requests = contentRequests(current, body, mode);
  if (!requests.length) return current;
  await callGoogleConnectorTool(host, "drive", "google_drive_batch_update_document", {
    document_id: id,
    requests,
    ...(mode === "replace" && expectedRevisionId
      ? { write_control: { requiredRevisionId: expectedRevisionId } }
      : {}),
  });
  return documentResource(host, id);
}

async function writeNewConnectorDocument(
  host: AgentConnectorHost,
  folderId: string,
  input: { title: string; body: string; source: DocumentSource; operationId: string; payloadHash: string },
) {
  const state = readConnectorHostState(host);
  const priorValue = state.documentOperations[input.operationId];
  if (priorValue) {
    if (priorValue.startsWith("ambiguous:")) {
      throw new Error("That Google Doc creation may already have completed. Review the dedicated Drive folder before trying a new operation.");
    }
    if (priorValue.startsWith("pending:")) {
      throw new Error("That Google Doc creation is still unresolved. Review the dedicated Drive folder before trying a new operation.");
    }
    const record = state.documents[priorValue];
    if (record?.payloadHash && record.payloadHash !== input.payloadHash) {
      throw new Error("That document operation id was already used with different content.");
    }
    const existing = await readConnectorDocument(priorValue);
    if (existing && record?.state !== "pending" && record?.state !== "ambiguous") return existing;
    if (existing && await nativePlainBodyMatches(host, existing.id, input.body)) {
      saveRecord(host, {
        id: existing.id,
        source: input.source,
        operationId: input.operationId,
        payloadHash: input.payloadHash,
        state: "complete",
        createdAt: record?.createdAt ?? existing.createdAt,
        updatedAt: existing.updatedAt,
      });
      return existing;
    }
    if (existing) {
      throw new Error(
        "That Google Doc creation is unresolved and its contents do not match the requested document. Review it in Google Docs before starting a new operation.",
      );
    }
    throw new Error("That document operation already completed, but its Google Doc is no longer in the managed folder.");
  }

  saveOperation(host, input.operationId, `pending:${input.payloadHash}:${new Date().toISOString()}`);
  let file: ReturnType<typeof connectorCreatedFile>;
  try {
    const created = await callGoogleConnectorTool(host, "drive", "google_drive_create_file", {
      mime_type: DOCUMENT_MIME_TYPE,
      title: input.title,
    });
    file = connectorCreatedFile(created, DOCUMENT_MIME_TYPE, input.title);
  } catch (error) {
    saveOperation(host, input.operationId, `ambiguous:${input.payloadHash}:${new Date().toISOString()}`);
    throw error;
  }

  const now = new Date().toISOString();
  saveRecord(host, {
    id: file.id,
    source: input.source,
    operationId: input.operationId,
    payloadHash: input.payloadHash,
    state: "pending",
    createdAt: file.createdTime ?? now,
    updatedAt: file.modifiedTime ?? now,
  });
  await moveNewFile(host, file, folderId);
  try {
    await updateDocumentContent(host, file.id, input.body, "replace");
  } catch (error) {
    try {
      const recovered = await readConnectorDocument(file.id);
      if (!recovered || !(await nativePlainBodyMatches(host, file.id, input.body))) throw error;
    } catch {
      updateConnectorHostState(host, (current) => ({
        ...current,
        documents: {
          ...current.documents,
          [file.id]: { ...current.documents[file.id], state: "ambiguous", updatedAt: new Date().toISOString() },
        },
      }));
      throw error;
    }
  }
  const saved = await readConnectorDocument(file.id);
  if (!saved) throw new Error("The new Google document could not be read back.");
  saveRecord(host, {
    id: file.id,
    source: input.source,
    operationId: input.operationId,
    payloadHash: input.payloadHash,
    state: "complete",
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
  });
  return saved;
}

export async function writeConnectorDocument(input: WriteDocumentInput): Promise<StudioDocument> {
  return queueDocumentMutation(async () => {
    const body = typeof input.body === "string" ? input.body : "";
    if (body.length > MAX_BODY_CHARS) throw new Error("That document is too large to save.");
    const requestedId = (input.id ?? input.documentId ?? input.slug ?? "").trim();
    const mode: WriteMode = input.mode === "append" ? "append" : "replace";
    const { host, workspace } = await ensureConnectorWorkspace();

    if (requestedId && !input.createNew) {
      const existing = await readConnectorDocument(requestedId);
      if (!existing) throw new Error(`No managed Google document with id "${requestedId}".`);
      if (mode === "replace" && !input.expectedRevisionId?.trim()) {
        throw new Error("Replacing a Google Doc requires the revision id from a fresh read, so newer human edits are not overwritten.");
      }
      if (mode === "append" && !body.trim()) throw new Error("There is nothing to append.");
      const operationPayload = digest({ requestedId, mode, title: input.title, body, source: input.source ?? existing.source });
      const operationId = `${mode}:${requestedId}:${input.operationId?.trim() || operationPayload}`;
      const prior = readConnectorHostState(host).documentOperations[operationId];
      if (prior) {
        if (prior !== `${requestedId}:${operationPayload}`) {
          throw new Error("That document operation id was already used with different content.");
        }
        const completed = await readConnectorDocument(requestedId);
        if (!completed) throw new Error("The completed Google Doc operation no longer has a managed document.");
        return completed;
      }
      saveOperation(host, operationId, `pending:${requestedId}:${operationPayload}`);
      let native: docs_v1.Schema$Document;
      try {
        native = await updateDocumentContent(
          host,
          requestedId,
          body,
          mode,
          mode === "replace" ? input.expectedRevisionId?.trim() : undefined,
        );
      } catch (error) {
        if (mode === "append") {
          try {
            const recovered = await readConnectorDocument(requestedId);
            const nativeAfter = await documentResource(host, requestedId);
            const addition = `${appendPrefix(existing.body, body)}${body}`;
            const intendedPlainSuffix = renderMarkdownForGoogleDocs(addition).text.trimEnd();
            if (!recovered || !documentPlainText(nativeAfter).trimEnd().endsWith(intendedPlainSuffix)) throw error;
            native = nativeAfter;
          } catch {
            saveOperation(host, operationId, `ambiguous:${requestedId}:${operationPayload}`);
            throw error;
          }
        } else {
          saveOperation(host, operationId, `ambiguous:${requestedId}:${operationPayload}`);
          throw error;
        }
      }
      if (input.title?.trim() && input.title.trim() !== existing.title) {
        await callGoogleConnectorTool(host, "drive", "google_drive_update_file", {
          fileId: requestedId,
          name: input.title.trim(),
        });
      }
      saveOperation(host, operationId, `${requestedId}:${operationPayload}`);
      const saved = await readConnectorDocument(requestedId);
      if (!saved) throw new Error("The Google document could not be read back after saving.");
      const priorRecord = recordFor(host, requestedId);
      saveRecord(host, {
        id: requestedId,
        source: input.source ?? priorRecord?.source ?? existing.source,
        operationId: priorRecord?.operationId ?? null,
        payloadHash: priorRecord?.payloadHash ?? null,
        state: "complete",
        createdAt: priorRecord?.createdAt ?? saved.createdAt,
        updatedAt: saved.updatedAt,
      });
      void native;
      return saved;
    }

    const title = (input.title ?? "").trim();
    if (!title) throw new Error("A document needs a title.");
    const documentSource = source(input.source ?? "assistant");
    const payloadHash = digest({ title, body, source: documentSource });
    const operationId = `create:${input.operationId?.trim() || payloadHash}`;
    return writeNewConnectorDocument(host, workspace.folderId, {
      title,
      body,
      source: documentSource,
      operationId,
      payloadHash,
    });
  });
}

export async function deleteConnectorDocument(_id: string): Promise<boolean> {
  throw new Error(
    "Studio Assistant will not permanently delete connector-managed Drive files. Open the document in Google Docs and move it to Trash there.",
  );
}

type LegacyDocument = {
  slug: string;
  title: string;
  source: DocumentSource;
  body: string;
};

function parseLegacyDocument(filePath: string): LegacyDocument {
  const slug = path.basename(filePath, ".md");
  const raw = fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
  let title = slug;
  let documentSource: DocumentSource = "assistant";
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
        if (key === "source") documentSource = source(value);
      }
      body = raw.slice(end + 4).replace(/^\n+/, "");
    }
  }
  return { slug, title, source: documentSource, body };
}

export async function importLegacyDocumentsConnector(
  prior?: LegacyDocumentImportResult | null,
): Promise<LegacyDocumentImportResult> {
  const result: LegacyDocumentImportResult = { imported: [], skipped: [], failed: [] };
  const completed = new Map(
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
  for (const entry of entries
    .filter((candidate) => candidate.isFile() && candidate.name.endsWith(".md") && !candidate.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const legacy = parseLegacyDocument(path.join(directory, entry.name));
    const existing = completed.get(legacy.slug);
    if (existing) {
      result.skipped.push(existing);
      continue;
    }
    try {
      const saved = await writeConnectorDocument({
        title: legacy.title,
        body: legacy.body,
        source: legacy.source,
        operationId: `legacy:${legacy.slug}`,
      });
      result.imported.push({
        legacySlug: legacy.slug,
        id: saved.id,
        title: saved.title,
        webViewLink: saved.webViewLink,
      });
    } catch (error) {
      result.failed.push({
        legacySlug: legacy.slug,
        error: error instanceof Error ? error.message : "The document could not be imported.",
      });
    }
  }
  return result;
}
