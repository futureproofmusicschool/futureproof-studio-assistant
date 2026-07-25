"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useState } from "react";
import type { Contact, ContactLogEntry, Contacts, ContactStatus, LogChannel } from "@/lib/contacts";

type ContactsViewProps = {
  initialContacts: Contacts;
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

export function ContactsView({ initialContacts }: ContactsViewProps) {
  const [contacts, setContacts] = useState(initialContacts);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const editingContact = contacts.contacts.find((entry) => entry.id === editingId) ?? null;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/contacts", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      setContacts((await response.json()) as Contacts);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to refresh contacts");
    }
  }, []);

  useEffect(() => {
    const handleFocus = () => void refresh();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refresh]);

  const mutate = useCallback(
    async (path: string, options: RequestOptions) => {
      setBusy(true);
      setError(null);
      let requestError: Error | null = null;
      try {
        const response = await fetch(path, {
          method: options.method,
          headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
        if (!response.ok) throw new Error(await responseError(response));
      } catch (mutationError) {
        requestError = mutationError instanceof Error ? mutationError : new Error("Request failed");
        setError(requestError.message);
      }
      await refresh();
      setBusy(false);
      if (requestError) throw requestError;
    },
    [refresh],
  );

  async function createContact(category: string, name: string, role: string) {
    if (!name.trim()) return;
    try {
      await mutate("/api/contacts/entries", {
        method: "POST",
        body: { name: name.trim(), category, role: role.trim() },
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
    <section className="board-page contacts-page" aria-busy={busy}>
      <div className="board-heading">
        <div>
          <p className="eyebrow">Outreach</p>
          <h1>Contacts</h1>
        </div>
        <div className="board-heading-notes">
          <p className="board-hint">Track who to reach, what was said, and what came back.</p>
        </div>
      </div>

      {error ? (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()}>Retry</button>
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
                <p className="empty-list">No contacts yet</p>
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
                onCreate={(name, role) => void createContact(category.id, name, role)}
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
            await mutate(`/api/contacts/entries/${editingContact.id}`, {
              method: "PATCH",
              body: {
                log: [...editingContact.log, logEntry],
                lastContact: logEntry.date,
              },
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
  onCreate: (name: string, role: string) => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") onCancel();
    if (event.key === "Enter" && !event.nativeEvent.isComposing && name.trim()) {
      event.preventDefault();
      onCreate(name, role);
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
      <p><kbd>Enter</kbd> save <kbd>Esc</kbd> cancel</p>
    </div>
  );
}

function ContactPanel({
  busy,
  contact,
  contacts,
  onAddLog,
  onClose,
  onDelete,
  onSave,
}: {
  busy: boolean;
  contact: Contact;
  contacts: Contacts;
  onAddLog: (logEntry: ContactLogEntry) => Promise<void>;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onSave: (
    updates: Pick<Contact, "name" | "role" | "category" | "haveSamples" | "contact" | "notes"> & {
      lastContact: string | null;
    },
  ) => Promise<void>;
}) {
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
    try {
      await onSave({
        name: name.trim(),
        role,
        category,
        haveSamples,
        contact: contactMethod,
        notes,
        lastContact: lastContact || null,
      });
    } catch {
      return;
    }
  }

  async function addLog() {
    if (!logSummary.trim() || !logDate) return;
    try {
      await onAddLog({ date: logDate, channel: logChannel, summary: logSummary.trim() });
      setLogSummary("");
      setLastContact(logDate);
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
            <input onChange={(event) => setName(event.target.value)} required value={name} />
          </label>
          <div className="form-row">
            <label>
              Role
              <input
                onChange={(event) => setRole(event.target.value)}
                placeholder="e.g. electric violin"
                value={role}
              />
            </label>
            <label>
              Category
              <select onChange={(event) => setCategory(event.target.value)} value={category}>
                {contacts.categories.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            How to reach them
            <input
              onChange={(event) => setContactMethod(event.target.value)}
              placeholder="email, DM, mutual friend..."
              value={contactMethod}
            />
          </label>
          <label>
            Notes
            <textarea
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Context, angle, what to pitch"
              rows={4}
              value={notes}
            />
          </label>
          <div className="form-row">
            <label>
              Last contact
              <input onChange={(event) => setLastContact(event.target.value)} type="date" value={lastContact} />
            </label>
            <label className="checkbox-label">
              <input
                checked={haveSamples}
                onChange={(event) => setHaveSamples(event.target.checked)}
                type="checkbox"
              />
              Samples in hand
            </label>
          </div>

          <div className="panel-actions">
            {confirmDelete ? (
              <div className="delete-confirm">
                <span>Delete this contact?</span>
                <button disabled={busy} onClick={() => void onDelete()} type="button">Yes, delete</button>
                <button onClick={() => setConfirmDelete(false)} type="button">Cancel</button>
              </div>
            ) : (
              <button className="delete-button" onClick={() => setConfirmDelete(true)} type="button">Delete</button>
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
