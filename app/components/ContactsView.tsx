"use client";
import { clientFetch } from "@/lib/client-requests";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Contact, ContactLogAppend, Contacts, ContactStatus, LogChannel } from "@/lib/contacts";

type ContactsViewProps = {
  initialContacts: Contacts;
  initialError?: string | null;
  identityInSheet?: boolean;
  loadOnMount?: boolean;
};

type RequestOptions = {
  method: "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

const STATUSES: ContactStatus[] = ["to-contact", "contacted", "replied", "confirmed", "declined"];
const CHANNELS: LogChannel[] = ["email", "call", "dm", "in-person", "other"];

const STATUS_LABELS: Record<ContactStatus, string> = {
  "to-contact": "To contact",
  contacted: "Contacted",
  replied: "Replied",
  confirmed: "Confirmed",
  declined: "Declined",
};


async function responseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

function dateInputValue(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function todayInputValue() {
  const today = new Date();
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
}

function createHistoryOperationId() {
  return `h_${globalThis.crypto.randomUUID().replace(/-/g, "")}`;
}

function refreshFailureMessage(error: Error) {
  return `Contacts could not be refreshed, so the displayed data may be stale: ${error.message}`;
}

export function ContactsView({
  initialContacts,
  initialError = null,
  identityInSheet = true,
  loadOnMount = false,
}: ContactsViewProps) {
  const [contacts, setContacts] = useState(() => initialContacts);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(loadOnMount);
  const requestedInitialLoad = useRef(false);
  const refreshVersion = useRef(0);

  const editingContact = contacts.contacts.find((entry) => entry.id === editingId) ?? null;

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;

    try {
      const response = await clientFetch("/api/contacts", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      const next = (await response.json()) as Contacts;
      if (version !== refreshVersion.current) return null;
      setContacts(next);
      setError(null);
      return null;
    } catch (loadError) {
      if (version !== refreshVersion.current) return null;
      const failure =
        loadError instanceof Error ? loadError : new Error("Unable to refresh contacts");
      setError(refreshFailureMessage(failure));
      return failure;
    } finally {
      if (version === refreshVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loadOnMount && !requestedInitialLoad.current) {
      requestedInitialLoad.current = true;
      void refresh();
    }
    const handleFocus = () => void refresh();
    window.addEventListener("focus", handleFocus);
    window.addEventListener("studio-data-invalidated", handleFocus);
    return () => { window.removeEventListener("focus", handleFocus); window.removeEventListener("studio-data-invalidated", handleFocus); };
  }, [loadOnMount, refresh]);

  const mutate = useCallback(
    async (path: string, options: RequestOptions) => {
      setBusy(true);
      setError(null);
      let requestError: Error | null = null;
      let requestWarning: string | null = null;
      try {
        const response = await clientFetch(path, {
          method: options.method,
          headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
        if (!response.ok) throw new Error(await responseError(response));
        try {
          const result = (await response.json()) as { warning?: unknown };
          if (typeof result.warning === "string" && result.warning.trim()) {
            requestWarning = result.warning.trim();
          }
        } catch {
          // A successful mutation does not have to return JSON.
        }
      } catch (mutationError) {
        requestError = mutationError instanceof Error ? mutationError : new Error("Request failed");
      }
      const refreshError = await refresh();
      // Refresh and mutation failures are independent. Keep both visible so a
      // mutation warning cannot hide that the rendered contact data is stale.
      const messages = [
        requestError?.message,
        requestWarning,
        ...(refreshError ? [refreshFailureMessage(refreshError)] : []),
      ].filter((message): message is string => Boolean(message));
      setError(messages.length ? messages.join(" ") : null);
      setBusy(false);
      if (requestError) throw requestError;
    },
    [refresh],
  );

  async function createContact(category: string, id: string, name: string, role: string, contact: string) {
    if (!name.trim()) return;
    try {
      await mutate("/api/contacts/entries", {
        method: "POST",
        body: { id, name: name.trim(), category, role: role.trim(), contact: contact.trim() },
      });
      setAddingTo(null);
    } catch {
      return;
    }
  }

  async function patchContact(id: string, updates: Record<string, unknown>) {
    setContacts((current) => ({
      ...current,
      contacts: current.contacts.map((entry) =>
        entry.id === id ? { ...entry, ...updates } : entry,
      ),
    }));
    try {
      await mutate(`/api/contacts/entries/${id}`, { method: "PATCH", body: updates });
    } catch {
      return;
    }
  }

  function markContactedToday(entry: Contact) {
    void patchContact(entry.id, { status: "contacted", lastContact: todayInputValue() });
  }

  return (
    <section className="board-page contacts-page" aria-busy={busy || loading}>
      <div className="board-heading">
        <div>
          <p className="eyebrow">Outreach</p>
          <h1>Contacts</h1>
        </div>
        <div className="board-heading-notes">
          <p className="board-hint">
            {identityInSheet
              ? "Names, contact methods, outreach status, and history stay together in your managed Google Sheet."
              : "Names and contact methods stay in Google Contacts. Outreach status and history stay in your Google Sheet."}
          </p>
        </div>
      </div>

      {error ? (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <div>
            <Link href="/settings">Google settings</Link>
            <button type="button" onClick={() => void refresh()}>Retry</button>
          </div>
        </div>
      ) : null}

      {contacts.categories.map((category) => {
        const entries = contacts.contacts
          .filter((entry) => entry.category === category.id)
          .sort(
            (a, b) =>
              STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) ||
              a.name.localeCompare(b.name),
          );
        return (
          <section className="contacts-section" key={category.id}>
            <header className="contacts-section-header">
              <h2>{category.name}</h2>
              <span className="card-count" aria-label={`${entries.length} contacts`}>
                {entries.length}
              </span>
            </header>

            <div className="contacts-rows">
              {entries.length === 0 && addingTo !== category.id ? (
                <p className="empty-list">{loading ? "Loading contacts…" : "No contacts yet"}</p>
              ) : null}
              {entries.map((entry) => (
                <div className="contact-row" data-status={entry.status} key={entry.id}>
                  <button
                    className="contact-main"
                    onClick={() => setEditingId(entry.id)}
                    type="button"
                  >
                    <span className="contact-name">
                      {entry.name}
                      {entry.haveSamples ? (
                        <span className="samples-badge" title="Samples in hand">samples</span>
                      ) : null}
                    </span>
                    {entry.role ? <span className="contact-role">{entry.role}</span> : null}
                    {entry.contact ? <span className="contact-method">{entry.contact}</span> : null}
                    {entry.notes ? <span className="contact-notes">{entry.notes}</span> : null}
                    {entry.lastContact ? (
                      <span className="contact-last">Last contact {dateInputValue(entry.lastContact)}</span>
                    ) : null}
                    {entry.log.length > 0 ? (
                      <span className="contact-log-count">
                        {entry.log.length} log {entry.log.length === 1 ? "entry" : "entries"}
                      </span>
                    ) : null}
                  </button>
                  <div className="contact-controls">
                    <select
                      aria-label={`Status for ${entry.name}`}
                      className="status-select"
                      disabled={busy}
                      onChange={(event) => void patchContact(entry.id, { status: event.target.value })}
                      value={entry.status}
                    >
                      {STATUSES.map((status) => (
                        <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                      ))}
                    </select>
                    {entry.status === "to-contact" ? (
                      <button
                        className="mark-contacted-button"
                        disabled={busy}
                        onClick={() => markContactedToday(entry)}
                        type="button"
                      >
                        Contacted today
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {addingTo === category.id ? (
              <InlineContactForm
                disabled={busy}
                onCancel={() => setAddingTo(null)}
                onCreate={(id, name, role, contact) => void createContact(category.id, id, name, role, contact)}
              />
            ) : (
              <button className="add-card-button" onClick={() => setAddingTo(category.id)} type="button">
                <span aria-hidden="true">+</span>
                Add contact
              </button>
            )}
          </section>
        );
      })}

      {editingContact ? (
        <ContactPanel
          busy={busy}
          contact={editingContact}
          contacts={contacts}
          identityInSheet={identityInSheet}
          onClose={() => setEditingId(null)}
          onDelete={async () => {
            await mutate(`/api/contacts/entries/${editingContact.id}`, { method: "DELETE" });
            setEditingId(null);
          }}
          onSave={async (updates) => {
            await mutate(`/api/contacts/entries/${editingContact.id}`, {
              method: "PATCH",
              body: updates,
            });
            setEditingId(null);
          }}
          onAddLog={async (logEntry) => {
            await mutate(`/api/contacts/entries/${editingContact.id}/log`, {
              method: "POST",
              body: logEntry,
            });
          }}
        />
      ) : null}
    </section>
  );
}

function InlineContactForm({
  disabled,
  onCancel,
  onCreate,
}: {
  disabled: boolean;
  onCancel: () => void;
  onCreate: (id: string, name: string, role: string, contact: string) => void;
}) {
  const [id] = useState(() => `k_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [contact, setContact] = useState("");

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") onCancel();
    if (event.key === "Enter" && !event.nativeEvent.isComposing && name.trim()) {
      event.preventDefault();
      onCreate(id, name, role, contact);
    }
  }

  return (
    <div className="inline-card-form">
      <input
        aria-label="Contact name"
        autoFocus
        disabled={disabled}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Who?"
        value={name}
      />
      <input
        aria-label="Contact role"
        disabled={disabled}
        onChange={(event) => setRole(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Role (optional)"
        value={role}
      />
      <input
        aria-label="Contact method"
        disabled={disabled}
        onChange={(event) => setContact(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Email or contact method (optional)"
        value={contact}
      />
      <div className="inline-card-actions">
        <button
          disabled={disabled || !name.trim()}
          onClick={() => onCreate(id, name, role, contact)}
          type="button"
        >
          Save contact
        </button>
        <button disabled={disabled} onClick={onCancel} type="button">Cancel</button>
      </div>
      <p><kbd>Enter</kbd> save <kbd>Esc</kbd> cancel</p>
    </div>
  );
}

function ContactPanel({
  busy,
  contact,
  contacts,
  identityInSheet,
  onAddLog,
  onClose,
  onDelete,
  onSave,
}: {
  busy: boolean;
  contact: Contact;
  contacts: Contacts;
  identityInSheet: boolean;
  onAddLog: (logEntry: ContactLogAppend) => Promise<void>;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onSave: (updates: Partial<Pick<
    Contact,
    "name" | "role" | "category" | "haveSamples" | "contact" | "notes" | "lastContact"
  >>) => Promise<void>;
}) {
  type EditableField = "name" | "role" | "category" | "haveSamples" | "contact" | "notes" | "lastContact";
  const [name, setName] = useState(contact.name);
  const [role, setRole] = useState(contact.role);
  const [category, setCategory] = useState(contact.category);
  const [haveSamples, setHaveSamples] = useState(contact.haveSamples);
  const [contactMethod, setContactMethod] = useState(contact.contact);
  const [notes, setNotes] = useState(contact.notes);
  const [lastContact, setLastContact] = useState(dateInputValue(contact.lastContact));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [logDate, setLogDate] = useState(todayInputValue());
  const [logChannel, setLogChannel] = useState<LogChannel>("email");
  const [logSummary, setLogSummary] = useState("");
  const [logOperationId, setLogOperationId] = useState(createHistoryOperationId);
  const [dirtyFields, setDirtyFields] = useState<Set<EditableField>>(() => new Set());
  const dirtyFieldsRef = useRef<Set<EditableField>>(new Set());

  function markDirty(field: EditableField) {
    const next = new Set(dirtyFieldsRef.current);
    next.add(field);
    dirtyFieldsRef.current = next;
    setDirtyFields(next);
  }

  useEffect(() => {
    // Returning from Google refreshes the parent data. Untouched form
    // controls follow those external edits; fields the artist actively changed
    // here remain theirs until Save or Close.
    if (!dirtyFields.has("name")) setName(contact.name);
    if (!dirtyFields.has("role")) setRole(contact.role);
    if (!dirtyFields.has("category")) setCategory(contact.category);
    if (!dirtyFields.has("haveSamples")) setHaveSamples(contact.haveSamples);
    if (!dirtyFields.has("contact")) setContactMethod(contact.contact);
    if (!dirtyFields.has("notes")) setNotes(contact.notes);
    if (!dirtyFields.has("lastContact")) setLastContact(dateInputValue(contact.lastContact));
  }, [contact, dirtyFields]);

  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    const updates: Partial<Pick<
      Contact,
      "name" | "role" | "category" | "haveSamples" | "contact" | "notes" | "lastContact"
    >> = {};
    if (dirtyFields.has("name")) updates.name = name.trim();
    if (dirtyFields.has("role")) updates.role = role;
    if (dirtyFields.has("category")) updates.category = category;
    if (dirtyFields.has("haveSamples")) updates.haveSamples = haveSamples;
    if (dirtyFields.has("contact")) updates.contact = contactMethod;
    if (dirtyFields.has("notes")) updates.notes = notes;
    if (dirtyFields.has("lastContact")) updates.lastContact = lastContact || null;
    if (Object.keys(updates).length === 0) {
      onClose();
      return;
    }
    try {
      await onSave(updates);
    } catch {
      return;
    }
  }

  async function addLog() {
    if (!logSummary.trim() || !logDate) return;
    try {
      await onAddLog({
        operationId: logOperationId,
        date: logDate,
        channel: logChannel,
        summary: logSummary.trim(),
      });
      setLogOperationId(createHistoryOperationId());
      setLogSummary("");
      if (!dirtyFieldsRef.current.has("lastContact")) setLastContact(logDate);
    } catch {
      return;
    }
  }

  return (
    <div className="panel-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="card-panel" role="dialog" aria-modal="true" aria-labelledby="contact-panel-title">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Contact details</p>
            <h2 id="contact-panel-title">{contact.name}</h2>
          </div>
          <button className="icon-button" aria-label="Close contact details" onClick={onClose} type="button">×</button>
        </div>

        <form className="card-form" onSubmit={submit}>
          <label>
            Name
            <input onChange={(event) => {
              setName(event.target.value);
              markDirty("name");
            }} required value={name} />
          </label>
          <div className="form-row">
            <label>
              Role
              <input
                onChange={(event) => {
                  setRole(event.target.value);
                  markDirty("role");
                }}
                placeholder="e.g. electric violin"
                value={role}
              />
            </label>
            <label>
              Category
              <select onChange={(event) => {
                setCategory(event.target.value);
                markDirty("category");
              }} value={category}>
                {contacts.categories.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            How to reach them
            <input
              onChange={(event) => {
                setContactMethod(event.target.value);
                markDirty("contact");
              }}
              placeholder="email, DM, mutual friend..."
              value={contactMethod}
            />
          </label>
          <label>
            Notes
            <textarea
              onChange={(event) => {
                setNotes(event.target.value);
                markDirty("notes");
              }}
              placeholder="Context, angle, what to pitch"
              rows={4}
              value={notes}
            />
          </label>
          <div className="form-row">
            <label>
              Last contact
              <input onChange={(event) => {
                setLastContact(event.target.value);
                markDirty("lastContact");
              }} type="date" value={lastContact} />
            </label>
            <label className="checkbox-label">
              <input
                checked={haveSamples}
                onChange={(event) => {
                  setHaveSamples(event.target.checked);
                  markDirty("haveSamples");
                }}
                type="checkbox"
              />
              Samples in hand
            </label>
          </div>

          <div className="panel-actions">
            {confirmDelete ? (
              <div className="delete-confirm">
                <span>
                  {identityInSheet
                    ? "Remove this contact and its history from the managed Sheet?"
                    : "Remove from outreach? The Google Contact stays in your address book."}
                </span>
                <button disabled={busy} onClick={() => void onDelete()} type="button">Yes, remove</button>
                <button onClick={() => setConfirmDelete(false)} type="button">Cancel</button>
              </div>
            ) : (
              <button className="delete-button" onClick={() => setConfirmDelete(true)} type="button">Remove from outreach</button>
            )}
            <button className="save-button" disabled={busy || !name.trim()} type="submit">
              {busy ? "Saving" : "Save changes"}
            </button>
          </div>
        </form>

        <div className="contact-log">
          <h3>History</h3>
          {contact.log.length === 0 ? (
            <p className="empty-list">No correspondence logged yet</p>
          ) : (
            <ul className="contact-log-list">
              {[...contact.log].reverse().map((entry, index) => (
                <li key={`${entry.date}-${index}`}>
                  <span className="log-date">{entry.date}</span>
                  <span className="log-channel">{entry.channel}</span>
                  <span className="log-summary">{entry.summary}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="log-form">
            <div className="form-row">
              <label>
                Date
                <input onChange={(event) => setLogDate(event.target.value)} type="date" value={logDate} />
              </label>
              <label>
                Channel
                <select
                  onChange={(event) => setLogChannel(event.target.value as LogChannel)}
                  value={logChannel}
                >
                  {CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>{channel}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              What was said
              <input
                onChange={(event) => setLogSummary(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void addLog();
                  }
                }}
                placeholder="One line: what went out or came back"
                value={logSummary}
              />
            </label>
            <button
              className="save-button"
              disabled={busy || !logSummary.trim() || !logDate}
              onClick={() => void addLog()}
              type="button"
            >
              Add log entry
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
