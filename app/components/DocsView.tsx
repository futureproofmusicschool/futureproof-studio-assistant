"use client";
import { clientFetch } from "@/lib/client-requests";

import { KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DocumentSource, DocumentSummary, StudioDocument } from "@/lib/documents";

/**
 * Google Docs are canonical. This tab is a lightweight index and preview so
 * the artist can find work from the conversation, then open the native editor
 * for collaboration, comments, sharing, and revision history.
 */
type DocsViewProps = {
  assistantName: string;
  initialDocuments: DocumentSummary[];
  initialError?: string;
  canTrash?: boolean;
  loadOnMount?: boolean;
};

const SOURCE_LABELS: Record<DocumentSource, string> = {
  assistant: "",
  you: "Yours",
  "deep-research": "Research",
};


async function responseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

function whenLabel(iso: string) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";

  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round(
    (startOfDay(new Date()).getTime() - startOfDay(then).getTime()) / 86_400_000,
  );

  if (days <= 0) return `Today ${then.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

/** A migrated markdown file may repeat its Drive title as the first heading. */
function bodyForDisplay(document: StudioDocument) {
  const heading = document.body.match(/^#\s+(.+?)[ \t]*\n+/);
  if (heading && heading[1].trim().toLowerCase() === document.title.trim().toLowerCase()) {
    return document.body.slice(heading[0].length);
  }
  return document.body;
}

export function DocsView({
  assistantName,
  initialDocuments,
  initialError,
  canTrash = true,
  loadOnMount = false,
}: DocsViewProps) {
  const [documents, setDocuments] = useState(() => initialDocuments);
  const [selected, setSelected] = useState<StudioDocument | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(loadOnMount);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const requestedInitialLoad = useRef(false);
  const refreshVersion = useRef(0);
  const selectionVersion = useRef(0);
  const selectedIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;

    try {
      const response = await clientFetch("/api/documents", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      const body = (await response.json()) as { documents: DocumentSummary[] };
      if (version !== refreshVersion.current) return;
      setDocuments(body.documents);
      setError(null);
    } catch (loadError) {
      if (version !== refreshVersion.current) return null;
      setError(loadError instanceof Error ? loadError.message : "Unable to refresh documents");
    } finally {
      if (version === refreshVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loadOnMount || requestedInitialLoad.current) return;
    requestedInitialLoad.current = true;
    void refresh();
  }, [loadOnMount, refresh]);

  const loadDocument = useCallback(async (id: string, showBusy = true) => {
    selectedIdRef.current = id;
    const version = ++selectionVersion.current;
    if (showBusy) setBusy(true);
    setConfirmTrash(false);
    try {
      const response = await clientFetch(`/api/documents/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      const document = (await response.json()) as StudioDocument;
      if (version !== selectionVersion.current) return;
      setSelected(document);
      setError(null);
    } catch (loadError) {
      if (version !== selectionVersion.current) return;
      setError(loadError instanceof Error ? loadError.message : "Unable to open that document");
    } finally {
      if (version === selectionVersion.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    // Native edits happen in a different tab. Returning here refreshes both
    // the ordering/excerpts and the currently visible preview.
    const handleFocus = () => {
      void refresh();
      if (selectedIdRef.current) void loadDocument(selectedIdRef.current, false);
    };
    const invalidate = () => {
      selectionVersion.current++;
      selectedIdRef.current = null;
      setSelected(null);
      setDocuments([]);
      setBusy(false);
      void refresh();
    };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("studio-data-invalidated", invalidate);
    return () => { window.removeEventListener("focus", handleFocus); window.removeEventListener("studio-data-invalidated", invalidate); };
  }, [loadDocument, refresh]);

  async function create(title: string, operationId: string) {
    setBusy(true);
    try {
      const response = await clientFetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, operationId }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const document = (await response.json()) as StudioDocument;
      selectionVersion.current++;
      setCreating(false);
      selectedIdRef.current = document.id;
      setSelected(document);
      setError(null);
      await refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create that document");
    } finally {
      setBusy(false);
    }
  }

  async function moveToTrash() {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await clientFetch(`/api/documents/${encodeURIComponent(selected.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await responseError(response));
      selectionVersion.current++;
      selectedIdRef.current = null;
      setSelected(null);
      setConfirmTrash(false);
      setError(null);
      await refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Unable to move that document to trash",
      );
    } finally {
      setBusy(false);
    }
  }

  function openInGoogleDocs() {
    if (!selected) return;
    window.open(selected.webViewLink, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="docs-page">
      <aside className="docs-sidebar">
        <div className="docs-sidebar-head">
          <div>
            <p className="eyebrow">Google Docs</p>
            <h1>
              {loading && !documents.length
                ? "Loading documents"
                : `${documents.length || "No"} document${documents.length === 1 ? "" : "s"}`}
            </h1>
          </div>
        </div>

        {creating ? (
          <NewDocumentForm disabled={busy} onCancel={() => setCreating(false)} onCreate={create} />
        ) : (
          <button className="add-card-button" disabled={loading} onClick={() => setCreating(true)} type="button">
            <span aria-hidden="true">+</span>
            New Google Doc
          </button>
        )}

        <div className="docs-list">
          {documents.map((document) => (
            <button
              className="docs-list-item"
              data-active={selected?.id === document.id ? "true" : "false"}
              key={document.id}
              onClick={() => void loadDocument(document.id)}
              type="button"
            >
              <span className="docs-list-title">{document.title}</span>
              {document.excerpt ? <span className="docs-list-excerpt">{document.excerpt}</span> : null}
              <span className="docs-list-meta">
                {whenLabel(document.updatedAt)}
                {SOURCE_LABELS[document.source] ? (
                  <em data-source={document.source}>{SOURCE_LABELS[document.source]}</em>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <div className="docs-reader">
        {error ? (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setError(null)} type="button">
              Dismiss
            </button>
          </div>
        ) : null}

        {selected ? (
          <article className="docs-document" aria-busy={busy}>
            <header className="docs-document-head">
              <h2>{selected.title}</h2>
              <div className="docs-document-actions">
                <button disabled={busy} onClick={openInGoogleDocs} type="button">
                  Open in Google Docs
                </button>
                <button
                  disabled={busy}
                  onClick={() => void navigator.clipboard.writeText(selected.body)}
                  type="button"
                >
                  Copy text
                </button>
                {!canTrash ? null : confirmTrash ? (
                  <button
                    className="docs-delete-confirm"
                    disabled={busy}
                    onClick={() => void moveToTrash()}
                    type="button"
                  >
                    Move to trash
                  </button>
                ) : (
                  <button disabled={busy} onClick={() => setConfirmTrash(true)} type="button">
                    Trash
                  </button>
                )}
              </div>
            </header>

            <p className="docs-document-meta">
              Updated {whenLabel(selected.updatedAt)} · Stored in Google Drive
            </p>

            {selected.body.trim() ? (
              <div className="chat-markdown docs-body">
                <Markdown remarkPlugins={[remarkGfm]}>{bodyForDisplay(selected)}</Markdown>
              </div>
            ) : (
              <div className="docs-native-empty">
                <p>This Google Doc is empty.</p>
                <button disabled={busy} onClick={openInGoogleDocs} type="button">
                  Start writing in Google Docs
                </button>
              </div>
            )}
          </article>
        ) : (
          <div className="docs-empty">
            <p className="eyebrow">{loading ? "Connecting to Google Drive" : "Nothing open"}</p>
            <h2>{loading ? "Loading your documents…" : documents.length ? "Pick a document" : "No Google Docs yet"}</h2>
            <p>
              {loading
                ? "The page is ready. Your Google Docs will appear here as soon as Drive responds."
                : documents.length
                ? "Open a document here for a quick preview, then continue writing or sharing it in Google Docs."
                : `Ask ${assistantName} to write something down, or create a Google Doc here. Documents stay in your Google Drive so you can share and edit them anywhere.`}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function NewDocumentForm({
  disabled,
  onCancel,
  onCreate,
}: {
  disabled: boolean;
  onCancel: () => void;
  onCreate: (title: string, operationId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [operationId] = useState(() => crypto.randomUUID());

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") onCancel();
    if (event.key === "Enter" && !event.nativeEvent.isComposing && title.trim()) {
      event.preventDefault();
      onCreate(title.trim(), operationId);
    }
  }

  return (
    <div className="inline-card-form">
      <input
        aria-label="Document title"
        autoFocus
        disabled={disabled}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Title"
        value={title}
      />
      <button
        className="save-button"
        disabled={disabled || !title.trim()}
        onClick={() => onCreate(title.trim(), operationId)}
        type="button"
      >
        {disabled ? "Creating…" : "Create"}
      </button>
      <p>
        <kbd>Enter</kbd> create <kbd>Esc</kbd> cancel
      </p>
    </div>
  );
}
