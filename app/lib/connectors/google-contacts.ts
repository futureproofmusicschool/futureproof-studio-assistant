import "server-only";

import { createHash } from "node:crypto";
import type {
  Contact,
  ContactCategory,
  ContactInput,
  ContactLogEntry,
  Contacts,
  ContactStatus,
  ContactUpdate,
} from "@/lib/contacts";
import { callGoogleConnectorTool } from "@/lib/connectors/google-runtime";
import {
  CONNECTOR_CATEGORY_HEADERS,
  CONNECTOR_CONTACT_HEADERS,
  CONNECTOR_HISTORY_HEADERS,
  CONNECTOR_OPERATION_HEADERS,
  connectorSheetProperties,
  connectorSpreadsheetBatchUpdate,
  connectorSpreadsheetValues,
  ensureConnectorWorkspace,
  sheetRow,
} from "@/lib/connectors/google-workspace";

const DEFAULT_CATEGORIES: ContactCategory[] = [
  { id: "collaborators", name: "Collaborators" },
  { id: "leads", name: "Leads" },
  { id: "label", name: "Labels" },
];
const VALID_STATUSES = new Set<ContactStatus>([
  "to-contact",
  "contacted",
  "replied",
  "confirmed",
  "declined",
]);

type ParsedContact = { value: Contact; rowIndex: number };
type ParsedHistory = ContactLogEntry & {
  operationId: string;
  contactId: string;
  createdAt: string;
  rowIndex: number;
};
type ParsedOperation = {
  operationId: string;
  kind: string;
  targetId: string;
  payloadHash: string;
  status: string;
};
type ConnectorContactState = {
  contacts: ParsedContact[];
  history: ParsedHistory[];
  categories: ContactCategory[];
  operations: ParsedOperation[];
};

let mutationTail: Promise<unknown> = Promise.resolve();

function queueMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutationTail.then(operation, operation);
  mutationTail = next.then(() => undefined, () => undefined);
  return next;
}

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function nullableText(value: unknown) {
  const normalized = text(value);
  return normalized || null;
}

function bool(value: unknown) {
  return value === true || String(value).toLowerCase() === "true" || value === 1;
}

function indexMap(row: unknown[], expected: readonly string[]) {
  const indexes = new Map(row.map((value, index) => [text(value), index]));
  return Object.fromEntries(expected.map((header, fallback) => [header, indexes.get(header) ?? fallback])) as Record<string, number>;
}

function valueAt(row: unknown[], indexes: Record<string, number>, name: string) {
  return row[indexes[name]];
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function historyOperationId(contactId: string, entry: ContactLogEntry, index: number) {
  return `h_${digest({ contactId, entry, index }).slice(0, 32)}`;
}

function serializeContact(contact: Contact) {
  return [
      contact.id,
      contact.name,
      contact.role,
      contact.contact,
      contact.category,
      contact.status,
      contact.haveSamples,
      contact.notes,
      contact.lastContact ?? "",
      contact.createdAt,
      contact.updatedAt,
    ];
}

function serializeHistory(history: ParsedHistory | (ContactLogEntry & { operationId: string; contactId: string; createdAt: string })) {
  return [history.operationId, history.contactId, history.date, history.channel, history.summary, history.createdAt];
}

function operationRow(input: {
  operationId: string;
  kind: string;
  targetId: string;
  payloadHash: string;
  providerId: string;
  createdAt?: string;
}) {
  const now = input.createdAt ?? new Date().toISOString();
  return [input.operationId, input.kind, input.targetId, input.payloadHash, "complete", input.providerId, now, now];
}

async function readState(): Promise<{
  host: Awaited<ReturnType<typeof ensureConnectorWorkspace>>["host"];
  spreadsheetId: string;
  state: ConnectorContactState;
}> {
  const { host, workspace } = await ensureConnectorWorkspace();
  if (!workspace.spreadsheetId) throw new Error("The managed outreach spreadsheet is not available.");
  const spreadsheetId = workspace.spreadsheetId;
  const [contactRows, historyRows, categoryRows, operationRows] = await Promise.all([
    connectorSpreadsheetValues(host, spreadsheetId, "Contacts", "A:L"),
    connectorSpreadsheetValues(host, spreadsheetId, "History", "A:F"),
    connectorSpreadsheetValues(host, spreadsheetId, "Categories", "A:C"),
    connectorSpreadsheetValues(host, spreadsheetId, "Operations", "A:H"),
  ]);

  const contactIndexes = indexMap(contactRows[0] ?? [], CONNECTOR_CONTACT_HEADERS);
  const historyIndexes = indexMap(historyRows[0] ?? [], CONNECTOR_HISTORY_HEADERS);
  const categoryIndexes = indexMap(categoryRows[0] ?? [], CONNECTOR_CATEGORY_HEADERS);
  const operationIndexes = indexMap(operationRows[0] ?? [], CONNECTOR_OPERATION_HEADERS);

  const history: ParsedHistory[] = historyRows.slice(1).flatMap((row, index) => {
    const operationId = text(valueAt(row, historyIndexes, "operationId"));
    const contactId = text(valueAt(row, historyIndexes, "contactId"));
    const date = text(valueAt(row, historyIndexes, "date"));
    const channel = text(valueAt(row, historyIndexes, "channel")) as ContactLogEntry["channel"];
    const summary = text(valueAt(row, historyIndexes, "summary"));
    const createdAt = text(valueAt(row, historyIndexes, "createdAt"));
    if (!operationId || !contactId || !date || !summary) return [];
    return [{ operationId, contactId, date, channel, summary, createdAt, rowIndex: index + 1 }];
  });
  const historyByContact = new Map<string, ContactLogEntry[]>();
  for (const entry of history) {
    const log = historyByContact.get(entry.contactId) ?? [];
    log.push({ date: entry.date, channel: entry.channel, summary: entry.summary });
    historyByContact.set(entry.contactId, log);
  }

  const contacts: ParsedContact[] = contactRows.slice(1).flatMap((row, index) => {
    const id = text(valueAt(row, contactIndexes, "id"));
    const name = text(valueAt(row, contactIndexes, "name"));
    const status = text(valueAt(row, contactIndexes, "status")) as ContactStatus;
    if (!id || !name || !VALID_STATUSES.has(status)) return [];
    const createdAt = text(valueAt(row, contactIndexes, "createdAt")) || new Date(0).toISOString();
    const updatedAt = text(valueAt(row, contactIndexes, "updatedAt")) || createdAt;
    return [{
      rowIndex: index + 1,
      value: {
        id,
        name,
        role: text(valueAt(row, contactIndexes, "role")),
        contact: text(valueAt(row, contactIndexes, "contact")),
        category: text(valueAt(row, contactIndexes, "category")) || "collaborators",
        status,
        haveSamples: bool(valueAt(row, contactIndexes, "haveSamples")),
        notes: text(valueAt(row, contactIndexes, "notes")),
        lastContact: nullableText(valueAt(row, contactIndexes, "lastContact")),
        log: (historyByContact.get(id) ?? []).sort((left, right) => left.date.localeCompare(right.date)),
        createdAt,
        updatedAt,
      },
    }];
  });
  const categories = categoryRows.slice(1).flatMap((row) => {
    const id = text(valueAt(row, categoryIndexes, "id"));
    const name = text(valueAt(row, categoryIndexes, "name"));
    return id && name ? [{ id, name }] : [];
  });
  const operations = operationRows.slice(1).flatMap((row) => {
    const operationId = text(valueAt(row, operationIndexes, "operationId"));
    if (!operationId) return [];
    return [{
      operationId,
      kind: text(valueAt(row, operationIndexes, "kind")),
      targetId: text(valueAt(row, operationIndexes, "targetId")),
      payloadHash: text(valueAt(row, operationIndexes, "payloadHash")),
      status: text(valueAt(row, operationIndexes, "status")),
    }];
  });
  return {
    host,
    spreadsheetId,
    state: {
      contacts,
      history,
      categories: categories.length ? categories : DEFAULT_CATEGORIES,
      operations,
    },
  };
}

async function sheetIds(
  host: Awaited<ReturnType<typeof ensureConnectorWorkspace>>["host"],
  spreadsheetId: string,
) {
  const metadata = await callGoogleConnectorTool(host, "drive", "google_drive_get_spreadsheet_metadata", {
    spreadsheet_id: spreadsheetId,
  });
  return new Map(connectorSheetProperties(metadata).map((sheet) => [sheet.title, sheet.sheetId]));
}

function requiredSheet(ids: Map<string, number>, name: string) {
  const id = ids.get(name);
  if (id === undefined) throw new Error(`The managed outreach spreadsheet is missing its ${name} tab.`);
  return id;
}

function appendCells(sheetId: number, rows: unknown[][]) {
  return {
    appendCells: {
      sheetId,
      rows: rows.map((row) => sheetRow(row)),
      fields: "userEnteredValue",
    },
  };
}

function updateCells(sheetId: number, rowIndex: number, values: unknown[]) {
  return {
    updateCells: {
      start: { sheetId, rowIndex, columnIndex: 0 },
      rows: [sheetRow(values)],
      fields: "userEnteredValue",
    },
  };
}

async function assertStableRow(
  host: Awaited<ReturnType<typeof ensureConnectorWorkspace>>["host"],
  spreadsheetId: string,
  sheetName: "Contacts" | "History",
  rowIndex: number,
  expectedId: string,
) {
  const rowNumber = rowIndex + 1;
  const rows = await connectorSpreadsheetValues(
    host,
    spreadsheetId,
    sheetName,
    `A${rowNumber}:A${rowNumber}`,
  );
  if (text(rows[0]?.[0]) !== expectedId) {
    throw new Error(
      `The managed outreach spreadsheet's ${sheetName} rows changed during this operation. Retry so Studio Assistant can locate the record by its stable id again.`,
    );
  }
}

export async function readConnectorContacts(): Promise<Contacts> {
  const { state } = await readState();
  return {
    version: 1,
    categories: state.categories,
    contacts: state.contacts.map((contact) => contact.value),
  };
}

export async function createConnectorContact(input: ContactInput): Promise<Contact> {
  return queueMutation(async () => {
    const { host, spreadsheetId, state } = await readState();
    if (!input.id) throw new Error("Connector-backed contact creation requires a stable contact id.");
    const existing = state.contacts.find((contact) => contact.value.id === input.id)?.value;
    if (existing) return existing;
    if (!state.categories.some((category) => category.id === input.category)) throw new Error("Category does not exist");
    const now = new Date().toISOString();
    const contact: Contact = {
      ...input,
      id: input.id,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    const history = input.log.map((entry, index) => ({
      ...entry,
      operationId: historyOperationId(contact.id, entry, index),
      contactId: contact.id,
      createdAt: now,
    }));
    const ids = await sheetIds(host, spreadsheetId);
    const operationId = `contact-create:${contact.id}`;
    await connectorSpreadsheetBatchUpdate(host, spreadsheetId, [
      appendCells(requiredSheet(ids, "Contacts"), [serializeContact(contact)]),
      ...(history.length ? [appendCells(requiredSheet(ids, "History"), history.map(serializeHistory))] : []),
      appendCells(requiredSheet(ids, "Operations"), [operationRow({
        operationId,
        kind: "contact.create",
        targetId: contact.id,
        payloadHash: digest(contact),
        providerId: spreadsheetId,
        createdAt: now,
      })]),
    ]);
    return contact;
  });
}

export async function updateConnectorContact(id: string, update: ContactUpdate): Promise<Contact | null> {
  return queueMutation(async () => {
    const { host, spreadsheetId, state } = await readState();
    const stored = state.contacts.find((contact) => contact.value.id === id);
    if (!stored) return null;
    const category = update.category ?? stored.value.category;
    if (!state.categories.some((entry) => entry.id === category)) throw new Error("Category does not exist");
    const next: Contact = {
      ...stored.value,
      ...update,
      category,
      updatedAt: new Date().toISOString(),
    };
    const ids = await sheetIds(host, spreadsheetId);
    await assertStableRow(host, spreadsheetId, "Contacts", stored.rowIndex, id);
    const operationId = `contact-update:${id}:${digest({ before: stored.value.updatedAt, update }).slice(0, 24)}`;
    await connectorSpreadsheetBatchUpdate(host, spreadsheetId, [
      updateCells(
        requiredSheet(ids, "Contacts"),
        stored.rowIndex,
        serializeContact(next),
      ),
      appendCells(requiredSheet(ids, "Operations"), [operationRow({
        operationId,
        kind: "contact.update",
        targetId: id,
        payloadHash: digest(update),
        providerId: spreadsheetId,
      })]),
    ]);
    return next;
  });
}

export async function removeConnectorContact(id: string): Promise<Contact | null> {
  return queueMutation(async () => {
    const { host, spreadsheetId, state } = await readState();
    const stored = state.contacts.find((contact) => contact.value.id === id);
    if (!stored) return null;
    const histories = state.history.filter((entry) => entry.contactId === id);
    const ids = await sheetIds(host, spreadsheetId);
    const contactSheetId = requiredSheet(ids, "Contacts");
    const historySheetId = requiredSheet(ids, "History");
    await assertStableRow(host, spreadsheetId, "Contacts", stored.rowIndex, id);
    await Promise.all(histories.map((entry) =>
      assertStableRow(host, spreadsheetId, "History", entry.rowIndex, entry.operationId)));
    await connectorSpreadsheetBatchUpdate(host, spreadsheetId, [
      updateCells(
        contactSheetId,
        stored.rowIndex,
        Array(CONNECTOR_CONTACT_HEADERS.length).fill(""),
      ),
      ...histories.map((entry) =>
        updateCells(historySheetId, entry.rowIndex, Array(CONNECTOR_HISTORY_HEADERS.length).fill(""))),
      appendCells(requiredSheet(ids, "Operations"), [operationRow({
        operationId: `contact-remove:${id}:${digest(stored.value.updatedAt).slice(0, 24)}`,
        kind: "contact.remove",
        targetId: id,
        payloadHash: digest(stored.value),
        providerId: spreadsheetId,
      })]),
    ]);
    return stored.value;
  });
}

export async function appendConnectorContactLog(
  contactId: string,
  entry: ContactLogEntry,
  operationId: string,
): Promise<boolean> {
  return queueMutation(async () => {
    const { host, spreadsheetId, state } = await readState();
    const stored = state.contacts.find((contact) => contact.value.id === contactId);
    if (!stored) return false;
    const completed = state.history.find((history) => history.operationId === operationId);
    if (completed) {
      if (
        completed.contactId !== contactId ||
        completed.date !== entry.date ||
        completed.channel !== entry.channel ||
        completed.summary !== entry.summary
      ) {
        throw new Error("That contact-history operation id was already used for different content.");
      }
      return true;
    }
    const now = new Date().toISOString();
    const history = { ...entry, operationId, contactId, createdAt: now };
    const updated = { ...stored.value, updatedAt: now };
    const ids = await sheetIds(host, spreadsheetId);
    await assertStableRow(host, spreadsheetId, "Contacts", stored.rowIndex, contactId);
    await connectorSpreadsheetBatchUpdate(host, spreadsheetId, [
      appendCells(requiredSheet(ids, "History"), [serializeHistory(history)]),
      updateCells(
        requiredSheet(ids, "Contacts"),
        stored.rowIndex,
        serializeContact(updated),
      ),
      appendCells(requiredSheet(ids, "Operations"), [operationRow({
        operationId,
        kind: "history.append",
        targetId: contactId,
        payloadHash: digest(entry),
        providerId: spreadsheetId,
        createdAt: now,
      })]),
    ]);
    return true;
  });
}

export async function mergeConnectorCategories(categories: ContactCategory[]) {
  return queueMutation(async () => {
    const { host, spreadsheetId, state } = await readState();
    const missing = categories.filter((category) =>
      category.id && category.name && !state.categories.some((existing) => existing.id === category.id));
    if (!missing.length) return;
    const ids = await sheetIds(host, spreadsheetId);
    await connectorSpreadsheetBatchUpdate(host, spreadsheetId, [
      appendCells(requiredSheet(ids, "Categories"), missing.map((category, index) => [
        category.id,
        category.name,
        state.categories.length + index,
      ])),
    ]);
  });
}

export async function importLegacyContactsConnector(
  legacy: Contacts,
  source: string,
): Promise<{ imported: number; matched: number; created: number; skipped: number; source: string }> {
  await mergeConnectorCategories(legacy.categories);
  let imported = 0;
  let skipped = 0;
  for (const contact of legacy.contacts) {
    const current = await readConnectorContacts();
    if (current.contacts.some((entry) => entry.id === contact.id)) {
      skipped += 1;
      continue;
    }
    await createConnectorContact(contact);
    imported += 1;
  }
  return { imported, matched: 0, created: imported, skipped, source };
}
