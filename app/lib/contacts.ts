import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { google, type people_v1, type sheets_v4 } from "googleapis";
import { isStaleGoogleContactIntent } from "@/lib/contact-retry";
import { getAuthorizedGoogleClient } from "@/lib/google/auth";
import { GOOGLE_SCOPES } from "@/lib/google/config";
import { readGoogleAuthorization, writePrivateGoogleJson } from "@/lib/google/store";
import { ensureOutreachSpreadsheet } from "@/lib/google/workspace";
import { dataPath } from "@/lib/paths";
import { usesAgentGoogleConnectors } from "@/lib/connectors/google-runtime";
import {
  appendConnectorContactLog,
  createConnectorContact,
  importLegacyContactsConnector,
  readConnectorContacts,
  removeConnectorContact,
  updateConnectorContact,
} from "@/lib/connectors/google-contacts";

/**
 * The public shape stays stable across both Google providers. Normal
 * Codex/Claude connector mode keeps identity and outreach data together in the
 * managed Sheet. The implementation below is the Advanced direct-OAuth path,
 * where identity lives in Google Contacts and workflow state lives in Sheets.
 */

export const CONTACT_STATUSES = [
  "to-contact",
  "contacted",
  "replied",
  "confirmed",
  "declined",
] as const;

export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const LOG_CHANNELS = ["email", "call", "dm", "in-person", "other"] as const;

export type LogChannel = (typeof LOG_CHANNELS)[number];

export type ContactLogEntry = {
  date: string;
  channel: LogChannel;
  summary: string;
};

export type ContactLogAppend = ContactLogEntry & { operationId: string };

export type ContactCategory = { id: string; name: string };

export type Contact = {
  id: string;
  name: string;
  role: string;
  category: string;
  status: ContactStatus;
  haveSamples: boolean;
  contact: string;
  notes: string;
  lastContact: string | null;
  log: ContactLogEntry[];
  createdAt: string;
  updatedAt: string;
};

export type Contacts = {
  version: 1;
  categories: ContactCategory[];
  contacts: Contact[];
};

export type ContactInput = Omit<Contact, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ContactUpdate = Partial<
  Pick<Contact, "name" | "role" | "category" | "status" | "haveSamples" | "contact" | "notes" | "lastContact">
>;

const CONTACT_HEADERS = [
  "id",
  "personResourceName",
  "nameSnapshot",
  "roleSnapshot",
  "contactSnapshot",
  "category",
  "status",
  "haveSamples",
  "notes",
  "lastContact",
  "createdAt",
  "updatedAt",
] as const;
const HISTORY_HEADERS = ["id", "contactId", "date", "channel", "summary", "createdAt"] as const;
const CATEGORY_HEADERS = ["id", "name", "position"] as const;
const DEFAULT_CATEGORIES: ContactCategory[] = [
  { id: "collaborators", name: "Collaborators" },
  { id: "leads", name: "Leads" },
  { id: "label", name: "Labels" },
];
const CONTACTS_RANGE = "'Contacts'!A:L";
const HISTORY_RANGE = "'History'!A:F";
const CATEGORIES_RANGE = "'Categories'!A:C";
const PERSON_FIELDS = "names,emailAddresses,phoneNumbers,organizations,userDefined,metadata";
const APP_FIELD_ID = "Futureproof Studio Assistant ID";
const APP_FIELD_ROLE = "Futureproof Studio Assistant Role";
const APP_FIELD_CONTACT = "Futureproof Studio Assistant Contact";
const APP_CONTACT_TYPE = "studio-assistant";
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CONTACT_ID_PATTERN = /^k_[a-z0-9]{8,64}$/i;
const HISTORY_OPERATION_ID_PATTERN = /^h_[a-f0-9]{32}$/i;
const PERSON_RESOURCE_PATTERN = /^people\/[^\s/]+$/;
const PENDING_CONTACTS_PATH = dataPath("google", "pending-contacts.json");
const CONTACT_MUTATION_LOCK_DIR = dataPath("google", "contact-locks");
const GOOGLE_MARKER_RECOVERY_DELAYS_MS = [0, 250, 500, 1_000] as const;
const CONTACT_LOCK_WAIT_MS = 60_000;
const CONTACT_LOCK_INCOMPLETE_STALE_MS = 5_000;
// Keep row-locator metadata compact: Google Sheets caps developer-metadata
// key/value storage per sheet. History uses the shorter contact id as its value
// so a normal long-running outreach log stays well inside that budget.
const CONTACT_ROW_METADATA_KEY = "fsa:c";
const HISTORY_ROW_METADATA_KEY = "fsa:h";

type ContactSheetRow = {
  id: string;
  personResourceName: string;
  nameSnapshot: string;
  roleSnapshot: string;
  contactSnapshot: string;
  category: string;
  status: ContactStatus;
  haveSamples: boolean;
  notes: string;
  lastContact: string | null;
  createdAt: string;
  updatedAt: string;
};

type HistorySheetRow = ContactLogEntry & {
  id: string;
  contactId: string;
  createdAt: string;
};

type SheetRecord<T> = { rowNumber: number; value: T };

type PendingContact = {
  resourceName: string | null;
  createdAt: string;
};

type PendingContactsFile = {
  version: 2;
  accounts: Record<string, { contacts: Record<string, PendingContact> }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIsoDateOrNull(value: unknown): value is string | null {
  if (value === null) return true;
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function isValidStatus(value: unknown): value is ContactStatus {
  return typeof value === "string" && (CONTACT_STATUSES as readonly string[]).includes(value);
}

export function isValidLogEntry(value: unknown): value is ContactLogEntry {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => key === "date" || key === "channel" || key === "summary") &&
    typeof value.date === "string" &&
    !Number.isNaN(Date.parse(value.date)) &&
    typeof value.channel === "string" &&
    (LOG_CHANNELS as readonly string[]).includes(value.channel) &&
    typeof value.summary === "string" &&
    value.summary.trim().length > 0
  );
}

export function isValidLog(value: unknown): value is ContactLogEntry[] {
  return Array.isArray(value) && value.every(isValidLogEntry);
}

export function isValidHistoryOperationId(value: unknown): value is string {
  return typeof value === "string" && HISTORY_OPERATION_ID_PATTERN.test(value);
}

export function isValidContactLogAppend(value: unknown): value is ContactLogAppend {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) =>
      key === "operationId" || key === "date" || key === "channel" || key === "summary"
    ) &&
    isValidHistoryOperationId(value.operationId) &&
    isValidLogEntry({ date: value.date, channel: value.channel, summary: value.summary })
  );
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isValidCategories(value: unknown): value is ContactCategory[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const categoryIds = new Set<string>();
  for (const category of value) {
    if (
      !isRecord(category) ||
      typeof category.id !== "string" ||
      !category.id.trim() ||
      category.id !== category.id.trim() ||
      typeof category.name !== "string" ||
      !category.name.trim() ||
      categoryIds.has(category.id)
    ) return false;
    categoryIds.add(category.id);
  }
  return true;
}

function isValidContactValue(value: unknown, categoryIds: ReadonlySet<string>): value is Contact {
  return (
    isRecord(value) &&
    isValidContactId(value.id) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.role === "string" &&
    typeof value.category === "string" &&
    categoryIds.has(value.category) &&
    isValidStatus(value.status) &&
    typeof value.haveSamples === "boolean" &&
    typeof value.contact === "string" &&
    typeof value.notes === "string" &&
    isIsoDateOrNull(value.lastContact) &&
    isValidLog(value.log) &&
    isValidTimestamp(value.createdAt) &&
    isValidTimestamp(value.updatedAt)
  );
}

export function isValidContacts(value: unknown): value is Contacts {
  if (!isRecord(value) || value.version !== 1) return false;
  if (!isValidCategories(value.categories) || !Array.isArray(value.contacts)) return false;

  const categoryIds = new Set(value.categories.map((category) => category.id));
  const ids = new Set<string>();
  for (const contact of value.contacts) {
    if (!isValidContactValue(contact, categoryIds) || ids.has(contact.id)) return false;
    ids.add(contact.id);
  }
  return true;
}

export function isValidLastContact(value: unknown) {
  return isIsoDateOrNull(value);
}

export function createContactId() {
  const bytes = crypto.randomBytes(8);
  const suffix = Array.from(bytes, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
  return `k_${suffix}`;
}

export function isValidContactId(value: unknown): value is string {
  return typeof value === "string" && CONTACT_ID_PATTERN.test(value);
}

function assertValidContactInput(input: ContactInput) {
  if (
    !isRecord(input) ||
    (input.id !== undefined && !isValidContactId(input.id)) ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    typeof input.role !== "string" ||
    typeof input.category !== "string" ||
    !input.category.trim() ||
    !isValidStatus(input.status) ||
    typeof input.haveSamples !== "boolean" ||
    typeof input.contact !== "string" ||
    typeof input.notes !== "string" ||
    !isIsoDateOrNull(input.lastContact) ||
    !isValidLog(input.log) ||
    (input.createdAt !== undefined && !isValidTimestamp(input.createdAt)) ||
    (input.updatedAt !== undefined && !isValidTimestamp(input.updatedAt))
  ) {
    throw new Error("Contact data is invalid.");
  }
}

const CONTACT_UPDATE_KEYS = new Set([
  "name",
  "role",
  "category",
  "status",
  "haveSamples",
  "contact",
  "notes",
  "lastContact",
]);

function assertValidContactUpdate(update: ContactUpdate) {
  if (
    !isRecord(update) ||
    Object.keys(update).some((key) => !CONTACT_UPDATE_KEYS.has(key)) ||
    (update.name !== undefined && (typeof update.name !== "string" || !update.name.trim())) ||
    (update.role !== undefined && typeof update.role !== "string") ||
    (update.category !== undefined && (typeof update.category !== "string" || !update.category.trim())) ||
    (update.status !== undefined && !isValidStatus(update.status)) ||
    (update.haveSamples !== undefined && typeof update.haveSamples !== "boolean") ||
    (update.contact !== undefined && typeof update.contact !== "string") ||
    (update.notes !== undefined && typeof update.notes !== "string") ||
    (update.lastContact !== undefined && !isIsoDateOrNull(update.lastContact))
  ) {
    throw new Error("Contact update is invalid.");
  }
}

function createHistoryId() {
  return `h_${crypto.randomUUID().replace(/-/g, "")}`;
}

function googleAccountSlot() {
  const authorization = readGoogleAuthorization();
  const identity = authorization?.subject
    ? `subject:${authorization.subject}`
    : authorization?.email
      ? `email:${authorization.email.trim().toLowerCase()}`
      : "";
  if (!identity) throw new Error("Google did not identify the connected account.");
  return crypto.createHash("sha256").update(identity).digest("hex");
}

function readPendingContacts(): PendingContactsFile {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(PENDING_CONTACTS_PATH, "utf8"));
    if (!isRecord(parsed) || parsed.version !== 2 || !isRecord(parsed.accounts)) {
      throw new Error("The pending Google Contacts recovery file is invalid.");
    }
    const accounts: PendingContactsFile["accounts"] = {};
    for (const [slot, account] of Object.entries(parsed.accounts)) {
      if (!/^[a-f0-9]{64}$/.test(slot) || !isRecord(account) || !isRecord(account.contacts)) {
        throw new Error("The pending Google Contacts recovery file is invalid.");
      }
      const contacts: Record<string, PendingContact> = {};
      for (const [id, entry] of Object.entries(account.contacts)) {
        if (
          !isValidContactId(id) ||
          !isRecord(entry) ||
          (entry.resourceName !== null &&
            (typeof entry.resourceName !== "string" || !PERSON_RESOURCE_PATTERN.test(entry.resourceName))) ||
          !isValidTimestamp(entry.createdAt)
        ) {
          throw new Error("The pending Google Contacts recovery file is invalid.");
        }
        contacts[id] = { resourceName: entry.resourceName as string | null, createdAt: entry.createdAt };
      }
      accounts[slot] = { contacts };
    }
    return { version: 2, accounts };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 2, accounts: {} };
    if (error instanceof SyntaxError) {
      throw new Error("The pending Google Contacts recovery file is unreadable.");
    }
    throw error;
  }
}

function pendingContact(accountSlot: string, id: string) {
  return readPendingContacts().accounts[accountSlot]?.contacts[id];
}

function pendingContactReservations(accountSlot: string, exceptId: string) {
  const contacts = readPendingContacts().accounts[accountSlot]?.contacts ?? {};
  const ids = new Set<string>();
  const resourceNames = new Set<string>();
  for (const [id, pending] of Object.entries(contacts)) {
    if (id === exceptId) continue;
    ids.add(id);
    if (pending.resourceName) resourceNames.add(pending.resourceName);
  }
  return { ids, resourceNames };
}

function savePendingContactIntent(accountSlot: string, id: string) {
  if (!/^[a-f0-9]{64}$/.test(accountSlot)) throw new Error("Google account recovery slot is invalid.");
  if (!isValidContactId(id)) {
    throw new Error("Cannot save invalid Google Contact recovery data.");
  }
  const pending = readPendingContacts();
  const account = pending.accounts[accountSlot] ?? { contacts: {} };
  account.contacts[id] ??= { resourceName: null, createdAt: new Date().toISOString() };
  pending.accounts[accountSlot] = account;
  writePrivateGoogleJson(PENDING_CONTACTS_PATH, pending);
}

function savePendingContactResource(accountSlot: string, id: string, resourceName: string) {
  if (!/^[a-f0-9]{64}$/.test(accountSlot)) throw new Error("Google account recovery slot is invalid.");
  if (!isValidContactId(id) || !PERSON_RESOURCE_PATTERN.test(resourceName)) {
    throw new Error("Cannot save invalid Google Contact recovery data.");
  }
  const pending = readPendingContacts();
  const account = pending.accounts[accountSlot] ?? { contacts: {} };
  account.contacts[id] = {
    resourceName,
    createdAt: account.contacts[id]?.createdAt ?? new Date().toISOString(),
  };
  pending.accounts[accountSlot] = account;
  writePrivateGoogleJson(PENDING_CONTACTS_PATH, pending);
}

function clearPendingContact(accountSlot: string, id: string) {
  const pending = readPendingContacts();
  const account = pending.accounts[accountSlot];
  if (!account || !(id in account.contacts)) return;
  delete account.contacts[id];
  if (!Object.keys(account.contacts).length) delete pending.accounts[accountSlot];
  writePrivateGoogleJson(PENDING_CONTACTS_PATH, pending);
}

function cellsByHeader(headers: string[], row: unknown[]) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}

function rowIsBlank(row: unknown[]) {
  return row.every((cell) => String(cell ?? "").trim() === "");
}

function assertSheetHeaders(values: unknown[][], expected: readonly string[], tab: string) {
  if (!values.length) return;
  const headers = values[0].map((value) => String(value).trim());
  const missing = expected.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`${tab} sheet is missing columns: ${missing.join(", ")}.`);
}

function parseBooleanCell(value: unknown, tab: string, rowNumber: number) {
  if (value === true || value === false) return value;
  const text = String(value).trim().toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  throw new Error(`${tab} row ${rowNumber} has an invalid boolean value.`);
}

function assertValidContactSheetRow(row: ContactSheetRow, categoryIds?: ReadonlySet<string>) {
  if (
    !isValidContactId(row.id) ||
    !PERSON_RESOURCE_PATTERN.test(row.personResourceName) ||
    !row.nameSnapshot.trim() ||
    typeof row.roleSnapshot !== "string" ||
    typeof row.contactSnapshot !== "string" ||
    !row.category.trim() ||
    (categoryIds !== undefined && !categoryIds.has(row.category)) ||
    !isValidStatus(row.status) ||
    typeof row.haveSamples !== "boolean" ||
    typeof row.notes !== "string" ||
    !isIsoDateOrNull(row.lastContact) ||
    !isValidTimestamp(row.createdAt) ||
    !isValidTimestamp(row.updatedAt)
  ) {
    throw new Error(`Contact ${row.id || "row"} contains invalid outreach data.`);
  }
}

function assertValidHistorySheetRow(row: HistorySheetRow) {
  if (
    !row.id.trim() ||
    !isValidContactId(row.contactId) ||
    !isValidLogEntry({ date: row.date, channel: row.channel, summary: row.summary }) ||
    !isValidTimestamp(row.createdAt)
  ) {
    throw new Error(`History row ${row.id || "without an id"} is invalid.`);
  }
}

function parseContactRows(values: unknown[][]): SheetRecord<ContactSheetRow>[] {
  if (!values.length) return [];
  assertSheetHeaders(values, CONTACT_HEADERS, "Contacts");
  const headers = values[0].map(String);
  return values.slice(1).flatMap((row, index) => {
    if (rowIsBlank(row)) return [];
    const rowNumber = index + 2;
    const cell = cellsByHeader(headers, row);
    const id = String(cell.id || "").trim();
    const status = String(cell.status || "");
    const value: ContactSheetRow = {
      id,
      personResourceName: String(cell.personResourceName || "").trim(),
      nameSnapshot: String(cell.nameSnapshot || ""),
      roleSnapshot: String(cell.roleSnapshot || ""),
      contactSnapshot: String(cell.contactSnapshot || ""),
      category: String(cell.category || "").trim(),
      status: status as ContactStatus,
      haveSamples: parseBooleanCell(cell.haveSamples, "Contacts", rowNumber),
      notes: String(cell.notes || ""),
      lastContact: String(cell.lastContact || "") || null,
      createdAt: String(cell.createdAt || ""),
      updatedAt: String(cell.updatedAt || ""),
    };
    try {
      assertValidContactSheetRow(value);
    } catch {
      throw new Error(`Contacts row ${rowNumber} contains invalid outreach data.`);
    }
    return [{ rowNumber, value }];
  });
}

function parseHistoryRows(values: unknown[][]): SheetRecord<HistorySheetRow>[] {
  if (!values.length) return [];
  assertSheetHeaders(values, HISTORY_HEADERS, "History");
  const headers = values[0].map(String);
  return values.slice(1).flatMap((row, index) => {
    if (rowIsBlank(row)) return [];
    const rowNumber = index + 2;
    const cell = cellsByHeader(headers, row);
    const value: HistorySheetRow = {
      id: String(cell.id || "").trim(),
      contactId: String(cell.contactId || "").trim(),
      date: String(cell.date || ""),
      channel: String(cell.channel || "") as LogChannel,
      summary: String(cell.summary || ""),
      createdAt: String(cell.createdAt || ""),
    };
    try {
      assertValidHistorySheetRow(value);
    } catch {
      throw new Error(`History row ${rowNumber} is invalid.`);
    }
    return [{ rowNumber, value }];
  });
}

function parseCategories(values: unknown[][]): ContactCategory[] {
  if (!values.length) return [];
  assertSheetHeaders(values, CATEGORY_HEADERS, "Categories");
  const headers = values[0].map(String);
  const seen = new Set<string>();
  return values.slice(1)
    .flatMap((row, index) => {
      if (rowIsBlank(row)) return [];
      const rowNumber = index + 2;
      const cell = cellsByHeader(headers, row);
      const id = String(cell.id || "").trim();
      const name = String(cell.name || "").trim();
      const position = Number(cell.position);
      if (!id || !name || seen.has(id) || !Number.isInteger(position) || position < 0) {
        throw new Error(`Categories row ${rowNumber} is invalid.`);
      }
      seen.add(id);
      return [{ id, name, position }];
    })
    .sort((a, b) => a.position - b.position)
    .map(({ id, name }) => ({ id, name }));
}

function serializeContactRow(row: ContactSheetRow) {
  return [
    row.id,
    row.personResourceName,
    row.nameSnapshot,
    row.roleSnapshot,
    row.contactSnapshot,
    row.category,
    row.status,
    row.haveSamples,
    row.notes,
    row.lastContact ?? "",
    row.createdAt,
    row.updatedAt,
  ];
}

function serializeHistoryRow(row: HistorySheetRow) {
  return [row.id, row.contactId, row.date, row.channel, row.summary, row.createdAt];
}

async function googleClients() {
  const auth = await getAuthorizedGoogleClient([GOOGLE_SCOPES.driveFile, GOOGLE_SCOPES.contacts]);
  const { spreadsheetId } = await ensureOutreachSpreadsheet();
  const sheets = google.sheets({ version: "v4", auth });
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  const sheetIds = Object.fromEntries(
    (metadata.data.sheets ?? []).flatMap((sheet) => {
      const id = sheet.properties?.sheetId;
      const title = sheet.properties?.title;
      return typeof id === "number" && title ? [[title, id] as const] : [];
    }),
  );
  if (
    typeof sheetIds.Contacts !== "number" ||
    typeof sheetIds.History !== "number" ||
    typeof sheetIds.Categories !== "number"
  ) {
    throw new Error("The outreach Sheet is missing a required tab.");
  }
  return {
    accountSlot: googleAccountSlot(),
    spreadsheetId,
    sheetIds: {
      Contacts: sheetIds.Contacts,
      History: sheetIds.History,
      Categories: sheetIds.Categories,
    },
    people: google.people({ version: "v1", auth }),
    sheets,
  };
}

async function sheetValues(sheets: sheets_v4.Sheets, spreadsheetId: string, range: string) {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return (response.data.values ?? []) as unknown[][];
}

async function readSheetState(clients: Awaited<ReturnType<typeof googleClients>>) {
  const [contactValues, historyValues, categoryValues] = await Promise.all([
    sheetValues(clients.sheets, clients.spreadsheetId, CONTACTS_RANGE),
    sheetValues(clients.sheets, clients.spreadsheetId, HISTORY_RANGE),
    sheetValues(clients.sheets, clients.spreadsheetId, CATEGORIES_RANGE),
  ]);
  const contactRows = parseContactRows(contactValues);
  const historyRows = parseHistoryRows(historyValues);
  const categories = parseCategories(categoryValues);
  const effectiveCategories = categories.length ? categories : DEFAULT_CATEGORIES;
  const categoryIds = new Set(effectiveCategories.map((category) => category.id));
  const contactIds = new Set<string>();
  const resourceNames = new Set<string>();
  for (const { value } of contactRows) {
    assertValidContactSheetRow(value, categoryIds);
    if (contactIds.has(value.id)) throw new Error(`Contacts sheet contains duplicate id ${value.id}.`);
    if (resourceNames.has(value.personResourceName)) {
      throw new Error(`Contacts sheet assigns ${value.personResourceName} to more than one outreach contact.`);
    }
    contactIds.add(value.id);
    resourceNames.add(value.personResourceName);
  }
  const historyIds = new Set<string>();
  for (const { value } of historyRows) {
    if (historyIds.has(value.id)) throw new Error(`History sheet contains duplicate id ${value.id}.`);
    historyIds.add(value.id);
  }
  return { contactRows, historyRows, categories };
}

function primary<T extends { metadata?: { primary?: boolean | null } | null }>(values?: T[] | null): T | undefined {
  return values?.find((value) => value.metadata?.primary) ?? values?.[0];
}

function appField(person: people_v1.Schema$Person, key: string) {
  return person.userDefined?.find((field) => field.key === key)?.value ?? "";
}

function appFieldValues(person: people_v1.Schema$Person, key: string) {
  return (person.userDefined ?? [])
    .filter((field) => field.key === key && field.value)
    .map((field) => field.value as string);
}

function identityFromPerson(person: people_v1.Schema$Person | undefined, fallback: ContactSheetRow) {
  const appEmail = person?.emailAddresses?.find((entry) => entry.type === APP_CONTACT_TYPE)?.value;
  const appPhone = person?.phoneNumbers?.find((entry) => entry.type === APP_CONTACT_TYPE)?.value;
  return {
    name:
      primary(person?.names)?.displayName ||
      primary(person?.names)?.unstructuredName ||
      fallback.nameSnapshot ||
      "Unknown contact",
    role:
      person?.organizations?.find((entry) => entry.type === APP_CONTACT_TYPE)?.title ||
      primary(person?.organizations)?.title ||
      (person && appField(person, APP_FIELD_ROLE)) ||
      fallback.roleSnapshot,
    contact:
      appEmail ||
      appPhone ||
      primary(person?.emailAddresses)?.value ||
      primary(person?.phoneNumbers)?.value ||
      (person && appField(person, APP_FIELD_CONTACT)) ||
      fallback.contactSnapshot,
  };
}

function publicContact(
  row: ContactSheetRow,
  identity: Pick<Contact, "name" | "role" | "contact">,
  log: ContactLogEntry[],
): Contact {
  return {
    id: row.id,
    ...identity,
    category: row.category,
    status: row.status,
    haveSamples: row.haveSamples,
    notes: row.notes,
    lastContact: row.lastContact,
    log,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getPeopleByResource(
  people: people_v1.People,
  resourceNames: string[],
) {
  const found = new Map<string, people_v1.Schema$Person>();
  for (let offset = 0; offset < resourceNames.length; offset += 200) {
    const batch = resourceNames.slice(offset, offset + 200);
    if (!batch.length) continue;
    const response = await people.people.getBatchGet({ resourceNames: batch, personFields: PERSON_FIELDS });
    for (const item of response.data.responses ?? []) {
      if (item.person?.resourceName) found.set(item.person.resourceName, item.person);
    }
  }
  return found;
}

function customUserFields(person: people_v1.Schema$Person, id: string, role: string, contact: string) {
  const managed = new Set([APP_FIELD_ID, APP_FIELD_ROLE, APP_FIELD_CONTACT]);
  return [
    ...(person.userDefined ?? []).filter((field) => !managed.has(field.key ?? "")),
    { key: APP_FIELD_ID, value: id },
    ...(role ? [{ key: APP_FIELD_ROLE, value: role }] : []),
    ...(contact ? [{ key: APP_FIELD_CONTACT, value: contact }] : []),
  ];
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function looksLikePhone(value: string) {
  return /^\+?[\d().\-\s]{7,}$/.test(value) && value.replace(/\D/g, "").length >= 7;
}

function normalizedEmail(value: string) {
  return looksLikeEmail(value.trim()) ? value.trim().toLowerCase() : "";
}

function normalizedPhone(value: string) {
  return looksLikePhone(value.trim()) ? value.replace(/\D/g, "") : "";
}

function organizationsWithRole(person: people_v1.Schema$Person, role: string) {
  const organizations = (person.organizations ?? []).filter((entry) => entry.type !== APP_CONTACT_TYPE);
  if (role) organizations.push({ type: APP_CONTACT_TYPE, title: role });
  return organizations;
}

function contactPointsWithValue(person: people_v1.Schema$Person, contact: string) {
  const emailAddresses = (person.emailAddresses ?? []).filter((entry) => entry.type !== APP_CONTACT_TYPE);
  const phoneNumbers = (person.phoneNumbers ?? []).filter((entry) => entry.type !== APP_CONTACT_TYPE);
  const email = normalizedEmail(contact);
  const phone = normalizedPhone(contact);
  if (email && !emailAddresses.some((entry) => normalizedEmail(entry.value ?? "") === email)) {
    emailAddresses.push({ type: APP_CONTACT_TYPE, value: contact });
  }
  if (phone && !phoneNumbers.some((entry) => normalizedPhone(entry.value ?? "") === phone)) {
    phoneNumbers.push({ type: APP_CONTACT_TYPE, value: contact });
  }
  return { emailAddresses, phoneNumbers };
}

function newGoogleIdentity(id: string, name: string, role: string, contact: string) {
  const methods = contactPointsWithValue({}, contact);

  return {
    names: [{ unstructuredName: name }],
    organizations: organizationsWithRole({}, role),
    emailAddresses: methods.emailAddresses,
    phoneNumbers: methods.phoneNumbers,
    userDefined: customUserFields({}, id, role, contact),
  } satisfies people_v1.Schema$Person;
}

let peopleMutationTail: Promise<void> = Promise.resolve();
let contactRowAppendTail: Promise<void> = Promise.resolve();
const historyAppendInFlight = new Map<string, Promise<boolean>>();
const contactMutationTails = new Map<string, Promise<void>>();

type ContactMutationLock = {
  version: 1;
  pid: number;
  token: string;
  accountSlot: string;
  createdAt: string;
};

function processIsAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function contactMutationLockPath(accountSlot: string) {
  if (!/^[a-f0-9]{64}$/.test(accountSlot)) throw new Error("Google account lock slot is invalid.");
  return path.join(CONTACT_MUTATION_LOCK_DIR, `${accountSlot}.lock`);
}

function contactLockCleanupInProgress() {
  try {
    return fs.readdirSync(CONTACT_MUTATION_LOCK_DIR).some((name) =>
      /^startup-[0-9]+-[a-f0-9-]+\.barrier$/.test(name),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function readContactMutationLock(lockPath: string): ContactMutationLock | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      typeof parsed.pid !== "number" ||
      typeof parsed.token !== "string" ||
      typeof parsed.accountSlot !== "string" ||
      !isValidTimestamp(parsed.createdAt)
    ) return null;
    return parsed as ContactMutationLock;
  } catch {
    return null;
  }
}

async function acquireContactMutationLock(accountSlot: string) {
  fs.mkdirSync(CONTACT_MUTATION_LOCK_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(CONTACT_MUTATION_LOCK_DIR, 0o700);
  } catch {
    // Some filesystems do not expose Unix permission bits.
  }
  const lockPath = contactMutationLockPath(accountSlot);
  const startedAt = Date.now();
  const lock: ContactMutationLock = {
    version: 1,
    pid: process.pid,
    token: crypto.randomUUID(),
    accountSlot,
    createdAt: new Date().toISOString(),
  };

  while (Date.now() - startedAt < CONTACT_LOCK_WAIT_MS) {
    if (contactLockCleanupInProgress()) {
      await waitFor(100);
      continue;
    }
    let descriptor: number | null = null;
    let createdFile = false;
    try {
      descriptor = fs.openSync(lockPath, "wx", 0o600);
      createdFile = true;
      fs.writeFileSync(descriptor, `${JSON.stringify(lock)}\n`, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      // From here on, cleanup must be token-aware: a startup cleaner could
      // remove this path and another process could replace it.
      createdFile = false;

      // A startup cleaner can publish its barrier after our first check but
      // before this exclusive create. Hold this token until every cleaner has
      // finished, verifying ownership throughout. A cleaner that read the old
      // pathname can remove this file, so ownership must also be proven after
      // the final barrier disappears before the mutation may begin.
      let lostOwnership = false;
      while (contactLockCleanupInProgress()) {
        if (Date.now() - startedAt >= CONTACT_LOCK_WAIT_MS) {
          throw new Error("Studio Assistant is still recovering outreach state. Restart it, then retry.");
        }
        await waitFor(100);
        if (readContactMutationLock(lockPath)?.token !== lock.token) {
          lostOwnership = true;
          break;
        }
      }
      if (lostOwnership || readContactMutationLock(lockPath)?.token !== lock.token) {
        await waitFor(100);
        continue;
      }
      return { lockPath, lock };
    } catch (error) {
      if (descriptor !== null) fs.closeSync(descriptor);
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        if (createdFile) {
          try {
            fs.unlinkSync(lockPath);
          } catch {
            // Preserve the original filesystem error.
          }
        }
        throw error;
      }

      const owner = readContactMutationLock(lockPath);
      if (owner && !processIsAlive(owner.pid)) {
        // Never reap here: two live route bundles could both observe the same
        // dead token and one could otherwise unlink the other's replacement.
        // server.js performs dead-lock cleanup synchronously before it listens.
        throw new Error("A prior outreach update ended unexpectedly. Restart Studio Assistant, then retry.");
      } else if (!owner) {
        // The creator can die between exclusive open and its tiny JSON write.
        // A young malformed file may still be in that window; only reap one
        // that has remained incomplete beyond the bounded grace period.
        try {
          const before = fs.statSync(lockPath);
          if (Date.now() - before.mtimeMs >= CONTACT_LOCK_INCOMPLETE_STALE_MS) {
            throw new Error("The outreach update lock is incomplete. Restart Studio Assistant, then retry.");
          }
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException).code !== "ENOENT") throw lockError;
        }
      }
      await waitFor(100);
    }
  }
  throw new Error("Another outreach update is still running. Wait for it to finish, then retry.");
}

async function withContactMutationLock<T>(accountSlot: string, operation: () => Promise<T>) {
  const acquired = await acquireContactMutationLock(accountSlot);
  try {
    return await operation();
  } finally {
    const current = readContactMutationLock(acquired.lockPath);
    if (current?.token === acquired.lock.token) {
      try {
        fs.unlinkSync(acquired.lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}

function queuePeopleMutation<T>(operation: () => Promise<T>) {
  const result = peopleMutationTail.then(operation, operation);
  peopleMutationTail = result.then(() => undefined, () => undefined);
  return result;
}

function queueContactRowAppend<T>(operation: () => Promise<T>) {
  const result = contactRowAppendTail.then(operation, operation);
  contactRowAppendTail = result.then(() => undefined, () => undefined);
  return result;
}

function queueContactMutation<T>(accountSlot: string, _contactId: string, operation: () => Promise<T>) {
  // One installation has one account and one workflow Sheet. Serializing the
  // complete mutation (including its Sheet append/update) keeps two concurrent
  // creates with the same email from both deciding that a Person is unclaimed.
  const key = accountSlot;
  const tail = contactMutationTails.get(key) ?? Promise.resolve();
  const run = () => withContactMutationLock(accountSlot, operation);
  const result = tail.then(run, run);
  const nextTail = result.then(() => undefined, () => undefined);
  contactMutationTails.set(key, nextTail);
  void nextTail.then(() => {
    if (contactMutationTails.get(key) === nextTail) contactMutationTails.delete(key);
  });
  return result;
}

async function createGoogleContactRequest(
  people: people_v1.People,
  id: string,
  identity: Pick<Contact, "name" | "role" | "contact">,
) {
  const requestBody = newGoogleIdentity(id, identity.name, identity.role, identity.contact);
  const response = await people.people.createContact({ requestBody, personFields: PERSON_FIELDS });
  if (!response.data.resourceName) throw new Error("Google Contacts created a contact without an id.");
  return response.data;
}

function googleErrorIsConflict(error: unknown) {
  if (!isRecord(error)) return false;
  const code = Number(error.code || (isRecord(error.response) && error.response.status));
  return code === 400 && /failed.?precondition|etag/i.test(String(error.message || ""));
}

async function updateGoogleContact(
  people: people_v1.People,
  resourceName: string,
  id: string,
  identity: Pick<Contact, "name" | "role" | "contact">,
  changes: { name: boolean; role: boolean; contact: boolean },
) {
  return queuePeopleMutation(async () => {
    const attempt = async () => {
      const current = await people.people.get({ resourceName, personFields: PERSON_FIELDS });
      const updatePersonFields = ["userDefined"];
      const requestBody: people_v1.Schema$Person = {
        resourceName: current.data.resourceName,
        etag: current.data.etag,
        metadata: current.data.metadata,
        userDefined: customUserFields(current.data, id, identity.role, identity.contact),
      };
      if (changes.name) {
        requestBody.names = [{ unstructuredName: identity.name }];
        updatePersonFields.push("names");
      }
      if (changes.role) {
        requestBody.organizations = organizationsWithRole(current.data, identity.role);
        updatePersonFields.push("organizations");
      }
      if (changes.contact) {
        const methods = contactPointsWithValue(current.data, identity.contact);
        requestBody.emailAddresses = methods.emailAddresses;
        requestBody.phoneNumbers = methods.phoneNumbers;
        updatePersonFields.push("emailAddresses", "phoneNumbers");
      }
      return people.people.updateContact({
        resourceName,
        updatePersonFields: updatePersonFields.join(","),
        personFields: PERSON_FIELDS,
        requestBody,
      });
    };

    try {
      return (await attempt()).data;
    } catch (error) {
      // A Google Contact can change in the browser between our GET and PATCH.
      // Fetch and merge once more rather than overwriting with a stale etag.
      if (!googleErrorIsConflict(error)) throw error;
      return (await attempt()).data;
    }
  });
}

async function markMatchedGoogleContact(
  people: people_v1.People,
  resourceName: string,
  id: string,
  fallback: Pick<Contact, "role" | "contact">,
  options: {
    allowOrphanReassignment?: boolean;
    accountSlot?: string;
    expectedEmail?: string;
  } = {},
) {
  return queuePeopleMutation(async () => {
    const attempt = async () => {
      const current = await people.people.get({ resourceName, personFields: PERSON_FIELDS });
      const markedIds = appFieldValues(current.data, APP_FIELD_ID);
      if (!options.allowOrphanReassignment && markedIds.some((markedId) => markedId !== id)) {
        throw new Error("That Google Contact is already marked for another outreach record.");
      }
      if (options.allowOrphanReassignment) {
        if (!options.accountSlot || !options.expectedEmail) {
          throw new Error("Google Contact orphan recovery is missing its account or email guard.");
        }
        const expectedEmail = normalizedEmail(options.expectedEmail);
        const stillMatches = current.data.emailAddresses?.some(
          (entry) => normalizedEmail(entry.value ?? "") === expectedEmail,
        );
        if (!expectedEmail || !stillMatches) {
          throw new Error("That Google Contact changed while it was being matched. Refresh and try again.");
        }
        const reservations = pendingContactReservations(options.accountSlot, id);
        if (
          reservations.resourceNames.has(resourceName) ||
          markedIds.some((markedId) => markedId !== id && reservations.ids.has(markedId))
        ) {
          throw new Error("That Google Contact belongs to another pending outreach record.");
        }
      }
      const role =
        appField(current.data, APP_FIELD_ROLE) ||
        (primary(current.data.organizations)?.title ? "" : fallback.role);
      const contact =
        appField(current.data, APP_FIELD_CONTACT) ||
        (primary(current.data.emailAddresses)?.value || primary(current.data.phoneNumbers)?.value ? "" : fallback.contact);
      return people.people.updateContact({
        resourceName,
        updatePersonFields: "userDefined",
        personFields: PERSON_FIELDS,
        requestBody: {
          resourceName: current.data.resourceName,
          etag: current.data.etag,
          metadata: current.data.metadata,
          userDefined: customUserFields(current.data, id, role, contact),
        },
      });
    };

    try {
      return (await attempt()).data;
    } catch (error) {
      if (!googleErrorIsConflict(error)) throw error;
      return (await attempt()).data;
    }
  });
}

function waitFor(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function findGoogleContactByMarker(people: people_v1.People, id: string) {
  const marked = (await listGoogleContacts(people)).filter((person) =>
    appFieldValues(person, APP_FIELD_ID).includes(id),
  );
  if (marked.length > 1) {
    throw new Error("More than one Google Contact has this Studio Assistant id; no new contact was created.");
  }
  return marked[0]?.resourceName ? marked[0] : undefined;
}

async function findGoogleContactByEmail(
  people: people_v1.People,
  contact: string,
  claimedResourceNames: ReadonlySet<string>,
) {
  const email = normalizedEmail(contact);
  if (!email) return undefined;
  const matches = (await listGoogleContacts(people)).filter(
    (person) =>
      Boolean(person.resourceName) &&
      !claimedResourceNames.has(person.resourceName as string) &&
      person.emailAddresses?.some((entry) => normalizedEmail(entry.value ?? "") === email),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

async function waitForGoogleContactMarker(people: people_v1.People, id: string) {
  for (const delay of GOOGLE_MARKER_RECOVERY_DELAYS_MS) {
    if (delay) await waitFor(delay);
    const marked = await findGoogleContactByMarker(people, id);
    if (marked) return marked;
  }
  return undefined;
}

function googleErrorDefinitelyRejected(error: unknown) {
  if (!isRecord(error)) return false;
  const code = Number(error.code || (isRecord(error.response) && error.response.status));
  return code >= 400 && code < 500 && ![408, 409, 425, 429].includes(code);
}

function assertAvailableGoogleContact(
  person: people_v1.Schema$Person,
  id: string,
  claimedResourceNames: ReadonlySet<string>,
) {
  if (!person.resourceName) throw new Error("Google Contacts returned a contact without an id.");
  if (claimedResourceNames.has(person.resourceName)) {
    throw new Error("That Google Contact is already assigned to another outreach record.");
  }
  const markedIds = appFieldValues(person, APP_FIELD_ID);
  if (markedIds.some((markedId) => markedId !== id)) {
    throw new Error("That Google Contact is marked for another outreach record.");
  }
  return person.resourceName;
}

async function recoverPendingGoogleContact(
  people: people_v1.People,
  accountSlot: string,
  id: string,
  fallback: Pick<Contact, "role" | "contact">,
  claimedResourceNames: ReadonlySet<string>,
) {
  const pending = pendingContact(accountSlot, id);
  if (!pending) return undefined;

  let person: people_v1.Schema$Person;
  if (pending.resourceName) {
    if (claimedResourceNames.has(pending.resourceName)) {
      throw new Error("A pending Google Contact is already assigned to another outreach record.");
    }
    try {
      const response = await people.people.get({
        resourceName: pending.resourceName,
        personFields: PERSON_FIELDS,
      });
      person = response.data;
    } catch {
      // Do not create another Person when Google's direct read has not caught
      // up. The resource mapping remains durable for a later retry.
      throw new Error("A previously created Google Contact is not readable yet. Retry this contact after Google syncs.");
    }
    if (person.resourceName !== pending.resourceName) {
      throw new Error("Google returned the wrong Contact for a pending outreach record.");
    }
  } else {
    const recovered = await waitForGoogleContactMarker(people, id);
    if (!recovered?.resourceName) {
      // A create request may have reached Google even when its HTTP response
      // did not reach us. Protect the full sync window before treating an
      // unmarked intent as a pre-request crash and allowing one fresh create.
      if (isStaleGoogleContactIntent(pending.createdAt)) {
        clearPendingContact(accountSlot, id);
        return undefined;
      }
      throw new Error("A prior Google Contact create is still unresolved. Retry after Google Contacts finishes syncing.");
    }
    person = recovered;
    assertAvailableGoogleContact(person, id, claimedResourceNames);
    savePendingContactResource(accountSlot, id, recovered.resourceName);
  }
  const resourceName = assertAvailableGoogleContact(person, id, claimedResourceNames);
  const markedIds = appFieldValues(person, APP_FIELD_ID);
  if (markedIds.some((markedId) => markedId !== id)) {
    throw new Error("A pending Google Contact is marked for another outreach record.");
  }
  return markedIds.includes(id)
    ? person
    : markMatchedGoogleContact(people, resourceName, id, fallback);
}

async function createGoogleContactWithIntent(
  people: people_v1.People,
  accountSlot: string,
  id: string,
  identity: Pick<Contact, "name" | "role" | "contact">,
  claimedResourceNames: ReadonlySet<string>,
) {
  return queuePeopleMutation(async () => {
    // The decision to create must be rechecked after waiting for the mutation
    // queue. Another UI or voice request may have completed this same stable id
    // while this operation was queued.
    const marked = await findGoogleContactByMarker(people, id);
    if (marked) {
      const resourceName = assertAvailableGoogleContact(marked, id, claimedResourceNames);
      savePendingContactResource(accountSlot, id, resourceName);
      return marked;
    }
    const alreadyPending = pendingContact(accountSlot, id);
    if (alreadyPending?.resourceName) {
      const response = await people.people.get({
        resourceName: alreadyPending.resourceName,
        personFields: PERSON_FIELDS,
      });
      const resourceName = assertAvailableGoogleContact(response.data, id, claimedResourceNames);
      savePendingContactResource(accountSlot, id, resourceName);
      return response.data;
    }
    if (alreadyPending) {
      const recovered = await waitForGoogleContactMarker(people, id);
      if (!recovered && !isStaleGoogleContactIntent(alreadyPending.createdAt)) {
        throw new Error("A prior Google Contact create is still unresolved. Retry after Google Contacts finishes syncing.");
      }
      if (recovered) {
        const resourceName = assertAvailableGoogleContact(recovered, id, claimedResourceNames);
        savePendingContactResource(accountSlot, id, resourceName);
        return recovered;
      }
      clearPendingContact(accountSlot, id);
    }

    // This write happens before the network call. If the process or response
    // disappears after Google commits, a retry searches by the stable app
    // marker instead of blindly creating a second Person.
    savePendingContactIntent(accountSlot, id);
    let person: people_v1.Schema$Person;
    try {
      person = await createGoogleContactRequest(people, id, identity);
    } catch (error) {
      if (googleErrorDefinitelyRejected(error)) {
        clearPendingContact(accountSlot, id);
        throw error;
      }
      const recovered = await waitForGoogleContactMarker(people, id);
      if (!recovered) {
        throw new Error("Google Contact creation has an unknown outcome. Retry after Google Contacts finishes syncing.");
      }
      person = recovered;
    }
    const resourceName = assertAvailableGoogleContact(person, id, claimedResourceNames);
    savePendingContactResource(accountSlot, id, resourceName);
    return person;
  });
}

async function resolveGoogleContactForCreate(
  people: people_v1.People,
  accountSlot: string,
  id: string,
  identity: Pick<Contact, "name" | "role" | "contact">,
  claimedResourceNames: ReadonlySet<string>,
) {
  const pending = await recoverPendingGoogleContact(people, accountSlot, id, identity, claimedResourceNames);
  if (pending?.resourceName) return pending;

  const marked = await findGoogleContactByMarker(people, id);
  if (marked) {
    const resourceName = assertAvailableGoogleContact(marked, id, claimedResourceNames);
    savePendingContactResource(accountSlot, id, resourceName);
    return marked;
  }
  const reservations = pendingContactReservations(accountSlot, id);
  const unavailableResourceNames = new Set([
    ...Array.from(claimedResourceNames),
    ...Array.from(reservations.resourceNames),
  ]);
  const emailMatch = await findGoogleContactByEmail(people, identity.contact, unavailableResourceNames);
  if (emailMatch?.resourceName) {
    // A Google Contact whose old app marker no longer has a Sheet row is an
    // orphan left by "Remove from outreach". Reassign that unclaimed marker
    // instead of creating a duplicate Person when the artist adds them again.
    const adopted = await markMatchedGoogleContact(people, emailMatch.resourceName, id, identity, {
      allowOrphanReassignment: true,
      accountSlot,
      expectedEmail: identity.contact,
    });
    const resourceName = assertAvailableGoogleContact(adopted, id, claimedResourceNames);
    savePendingContactResource(accountSlot, id, resourceName);
    return adopted;
  }
  return createGoogleContactWithIntent(people, accountSlot, id, identity, claimedResourceNames);
}

async function appendContactRow(clients: Awaited<ReturnType<typeof googleClients>>, row: ContactSheetRow) {
  assertValidContactSheetRow(row);
  return queueContactRowAppend(async () => {
    const latest = await readSheetState(clients);
    const existing = latest.contactRows.find((record) => record.value.id === row.id)?.value;
    if (existing) {
      if (existing.personResourceName !== row.personResourceName) {
        throw new Error(`Contact ${row.id} is already linked to another Google Contact.`);
      }
      return false;
    }
    if (latest.contactRows.some((record) => record.value.personResourceName === row.personResourceName)) {
      throw new Error("That Google Contact is already assigned to another outreach record.");
    }
    await clients.sheets.spreadsheets.values.append({
      spreadsheetId: clients.spreadsheetId,
      range: CONTACTS_RANGE,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [serializeContactRow(row)] },
    });
    return true;
  });
}

type ManagedRowTab = "Contacts" | "History";

function rowMetadataKey(tab: ManagedRowTab) {
  return tab === "Contacts" ? CONTACT_ROW_METADATA_KEY : HISTORY_ROW_METADATA_KEY;
}

async function searchRowMetadata(
  clients: Awaited<ReturnType<typeof googleClients>>,
  tab: ManagedRowTab,
  stableId: string,
) {
  const response = await clients.sheets.spreadsheets.developerMetadata.search({
    spreadsheetId: clients.spreadsheetId,
    requestBody: {
      dataFilters: [{
        developerMetadataLookup: {
          metadataKey: rowMetadataKey(tab),
          metadataValue: stableId,
          visibility: "DOCUMENT",
          locationType: "ROW",
        },
      }],
    },
  });
  return (response.data.matchedDeveloperMetadata ?? [])
    .map((match) => match.developerMetadata)
    .filter((metadata): metadata is sheets_v4.Schema$DeveloperMetadata => Boolean(metadata));
}

async function rowMetadataMatches(
  clients: Awaited<ReturnType<typeof googleClients>>,
  metadataId: number,
  stableId: string,
) {
  const response = await clients.sheets.spreadsheets.values.batchGetByDataFilter({
    spreadsheetId: clients.spreadsheetId,
    requestBody: {
      dataFilters: [{ developerMetadataLookup: { metadataId } }],
      majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE",
    },
  });
  const ranges = response.data.valueRanges ?? [];
  return (
    ranges.length === 1 &&
    String(ranges[0].valueRange?.values?.[0]?.[0] ?? "") === stableId
  );
}

async function rowsByMetadata(
  clients: Awaited<ReturnType<typeof googleClients>>,
  metadataIds: number[],
) {
  const rows = new Map<number, unknown[]>();
  for (let offset = 0; offset < metadataIds.length; offset += 100) {
    const chunk = metadataIds.slice(offset, offset + 100);
    const response = await clients.sheets.spreadsheets.values.batchGetByDataFilter({
      spreadsheetId: clients.spreadsheetId,
      requestBody: {
        dataFilters: chunk.map((metadataId) => ({ developerMetadataLookup: { metadataId } })),
        majorDimension: "ROWS",
        valueRenderOption: "UNFORMATTED_VALUE",
      },
    });
    for (const matched of response.data.valueRanges ?? []) {
      const row = (matched.valueRange?.values?.[0] ?? []) as unknown[];
      for (const filter of matched.dataFilters ?? []) {
        const metadataId = filter.developerMetadataLookup?.metadataId;
        if (typeof metadataId === "number") rows.set(metadataId, row);
      }
    }
  }
  return rows;
}

async function deleteRowMetadata(
  clients: Awaited<ReturnType<typeof googleClients>>,
  metadataIds: number[],
) {
  if (!metadataIds.length) return;
  await clients.sheets.spreadsheets.batchUpdate({
    spreadsheetId: clients.spreadsheetId,
    requestBody: {
      requests: metadataIds.map((metadataId) => ({
        deleteDeveloperMetadata: {
          dataFilter: { developerMetadataLookup: { metadataId } },
        },
      })),
    },
  });
}

async function ensureRowMetadata(
  clients: Awaited<ReturnType<typeof googleClients>>,
  tab: ManagedRowTab,
  stableId: string,
) {
  const sheetId = clients.sheetIds[tab];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const matches = await searchRowMetadata(clients, tab, stableId);
    const valid: number[] = [];
    const invalid: number[] = [];
    for (const metadata of matches) {
      const metadataId = metadata.metadataId;
      const range = metadata.location?.dimensionRange;
      if (
        typeof metadataId !== "number" ||
        range?.sheetId !== sheetId ||
        range.dimension !== "ROWS"
      ) {
        if (typeof metadataId === "number") invalid.push(metadataId);
        continue;
      }
      if (await rowMetadataMatches(clients, metadataId, stableId)) valid.push(metadataId);
      else invalid.push(metadataId);
    }
    if (valid.length) {
      // Duplicate markers can result from a lost response followed by a retry.
      // They are equivalent when they resolve to the same stable row; keep one.
      await deleteRowMetadata(clients, [...invalid, ...valid.slice(1)]);
      return valid[0];
    }
    await deleteRowMetadata(clients, invalid);

    // Resolve the current row immediately before attaching metadata. The create
    // request is atomic; if a browser sort wins the race, verification below
    // removes the misplaced marker without touching any cell values.
    const state = await readSheetState(clients);
    const record = tab === "Contacts"
      ? state.contactRows.find((row) => row.value.id === stableId)
      : state.historyRows.find((row) => row.value.id === stableId);
    if (!record) throw new Error(`The ${tab} row changed before it could be updated. Refresh and try again.`);
    const created = await clients.sheets.spreadsheets.batchUpdate({
      spreadsheetId: clients.spreadsheetId,
      requestBody: {
        requests: [{
          createDeveloperMetadata: {
            developerMetadata: {
              metadataKey: rowMetadataKey(tab),
              metadataValue: stableId,
              visibility: "DOCUMENT",
              location: {
                dimensionRange: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: record.rowNumber - 1,
                  endIndex: record.rowNumber,
                },
              },
            },
          },
        }],
      },
    });
    const metadataId = created.data.replies?.[0]?.createDeveloperMetadata?.developerMetadata?.metadataId;
    if (typeof metadataId === "number") {
      if (await rowMetadataMatches(clients, metadataId, stableId)) return metadataId;
      await deleteRowMetadata(clients, [metadataId]);
    }
  }
  throw new Error(`The ${tab} sheet kept changing while it was being updated. Nothing was overwritten; retry.`);
}

async function ensureHistoryRowMetadata(
  clients: Awaited<ReturnType<typeof googleClients>>,
  contactId: string,
) {
  const sheetId = clients.sheetIds.History;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await readSheetState(clients);
    const expected = state.historyRows.filter((row) => row.value.contactId === contactId);
    if (!expected.length) return [];
    const expectedIds = new Set(expected.map((row) => row.value.id));
    const matches = await searchRowMetadata(clients, "History", contactId);
    const metadataIds = matches.flatMap((metadata) =>
      typeof metadata.metadataId === "number" ? [metadata.metadataId] : [],
    );
    const rows = await rowsByMetadata(clients, metadataIds);
    const byHistoryId = new Map<string, number[]>();
    const invalid: number[] = [];
    for (const metadata of matches) {
      const metadataId = metadata.metadataId;
      const range = metadata.location?.dimensionRange;
      if (
        typeof metadataId !== "number" ||
        range?.sheetId !== sheetId ||
        range.dimension !== "ROWS"
      ) {
        if (typeof metadataId === "number") invalid.push(metadataId);
        continue;
      }
      const row = rows.get(metadataId) ?? [];
      const historyId = String(row[0] ?? "");
      if (String(row[1] ?? "") !== contactId || !expectedIds.has(historyId)) {
        invalid.push(metadataId);
        continue;
      }
      const ids = byHistoryId.get(historyId) ?? [];
      ids.push(metadataId);
      byHistoryId.set(historyId, ids);
    }

    const duplicates = Array.from(byHistoryId.values()).flatMap((ids) => ids.slice(1));
    await deleteRowMetadata(clients, [...invalid, ...duplicates]);
    const missing = expected.filter((row) => !byHistoryId.has(row.value.id));
    if (!missing.length) {
      return expected.map((row) => (byHistoryId.get(row.value.id) as number[])[0]);
    }

    const created = await clients.sheets.spreadsheets.batchUpdate({
      spreadsheetId: clients.spreadsheetId,
      requestBody: {
        requests: missing.map((record) => ({
          createDeveloperMetadata: {
            developerMetadata: {
              metadataKey: HISTORY_ROW_METADATA_KEY,
              metadataValue: contactId,
              visibility: "DOCUMENT",
              location: {
                dimensionRange: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: record.rowNumber - 1,
                  endIndex: record.rowNumber,
                },
              },
            },
          },
        })),
      },
    });
    const createdIds = (created.data.replies ?? []).flatMap((reply) => {
      const metadataId = reply.createDeveloperMetadata?.developerMetadata?.metadataId;
      return typeof metadataId === "number" ? [metadataId] : [];
    });
    const createdRows = await rowsByMetadata(clients, createdIds);
    const misplaced = createdIds.filter((metadataId) => {
      const row = createdRows.get(metadataId) ?? [];
      return String(row[1] ?? "") !== contactId || !expectedIds.has(String(row[0] ?? ""));
    });
    await deleteRowMetadata(clients, misplaced);
    if (!misplaced.length && createdIds.length === missing.length) {
      const complete = new Map(byHistoryId);
      for (const metadataId of createdIds) {
        const historyId = String(createdRows.get(metadataId)?.[0] ?? "");
        complete.set(historyId, [metadataId]);
      }
      if (expected.every((row) => complete.has(row.value.id))) {
        return expected.map((row) => (complete.get(row.value.id) as number[])[0]);
      }
    }
  }
  throw new Error("The History sheet kept changing during removal. Nothing was cleared; retry.");
}

async function updateContactRow(
  clients: Awaited<ReturnType<typeof googleClients>>,
  row: ContactSheetRow,
) {
  assertValidContactSheetRow(row);
  const metadataId = await ensureRowMetadata(clients, "Contacts", row.id);
  const response = await clients.sheets.spreadsheets.values.batchUpdateByDataFilter({
    spreadsheetId: clients.spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      includeValuesInResponse: true,
      responseValueRenderOption: "UNFORMATTED_VALUE",
      data: [{
        dataFilter: { developerMetadataLookup: { metadataId } },
        majorDimension: "ROWS",
        values: [serializeContactRow(row)],
      }],
    },
  });
  if (
    response.data.totalUpdatedRows !== 1 ||
    String(response.data.responses?.[0]?.updatedData?.values?.[0]?.[0] ?? "") !== row.id
  ) {
    throw new Error("Google Sheets did not confirm the intended outreach row update. Refresh and verify the Sheet.");
  }
}

async function writeCategories(clients: Awaited<ReturnType<typeof googleClients>>, categories: ContactCategory[]) {
  if (!isValidCategories(categories)) throw new Error("Contact categories are invalid.");
  // Every current caller initializes or appends categories; none removes them.
  // One update avoids a clear-then-write window that could invalidate contact
  // rows if the second request failed.
  await clients.sheets.spreadsheets.values.update({
    spreadsheetId: clients.spreadsheetId,
    range: "'Categories'!A2:C",
    valueInputOption: "RAW",
    requestBody: { values: categories.map((category, index) => [category.id, category.name, index]) },
  });
}

export async function readContacts(): Promise<Contacts> {
  if (usesAgentGoogleConnectors()) return readConnectorContacts();
  const clients = await googleClients();
  const state = await readSheetState(clients);
  const people = await getPeopleByResource(
    clients.people,
    state.contactRows.map((row) => row.value.personResourceName).filter(Boolean),
  );
  const history = new Map<string, ContactLogEntry[]>();
  for (const row of state.historyRows) {
    const entries = history.get(row.value.contactId) ?? [];
    entries.push({ date: row.value.date, channel: row.value.channel, summary: row.value.summary });
    history.set(row.value.contactId, entries);
  }

  return {
    version: 1,
    categories: state.categories.length ? state.categories : DEFAULT_CATEGORIES,
    contacts: state.contactRows.map(({ value }) =>
      publicContact(
        value,
        identityFromPerson(people.get(value.personResourceName), value),
        history.get(value.id) ?? [],
      ),
    ),
  };
}

export async function createContact(input: ContactInput): Promise<Contact> {
  assertValidContactInput(input);
  const id = input.id || createContactId();
  if (!isValidContactId(id)) throw new Error("Contact id is invalid.");
  if (usesAgentGoogleConnectors()) return createConnectorContact({ ...input, id });
  const clients = await googleClients();
  return queueContactMutation(clients.accountSlot, id, async () => {
    const state = await readSheetState(clients);
    const categories = state.categories.length ? state.categories : DEFAULT_CATEGORIES;
    if (!categories.some((category) => category.id === input.category)) throw new Error("Category does not exist");

    if (state.contactRows.some((row) => row.value.id === id)) {
      await ensureRowMetadata(clients, "Contacts", id);
      const existingSignatures = new Set(
        state.historyRows
          .filter((row) => row.value.contactId === id)
          .map((row) => logSignature(row.value)),
      );
      await appendHistoryEntries(
        clients,
        id,
        input.log.filter((entry) => !existingSignatures.has(logSignature(entry))),
      );
      await ensureHistoryRowMetadata(clients, id);
      clearPendingContact(clients.accountSlot, id);
      const existing = (await readContacts()).contacts.find((contact) => contact.id === id);
      if (existing) return existing;
      throw new Error("A contact with that id already exists but could not be read.");
    }
    if (!state.categories.length) await writeCategories(clients, DEFAULT_CATEGORIES);

    const now = new Date().toISOString();
    const person = await resolveGoogleContactForCreate(
      clients.people,
      clients.accountSlot,
      id,
      input,
      new Set(state.contactRows.map((row) => row.value.personResourceName)),
    );
    const row: ContactSheetRow = {
      id,
      personResourceName: person.resourceName as string,
      nameSnapshot: input.name,
      roleSnapshot: input.role,
      contactSnapshot: input.contact,
      category: input.category,
      status: input.status,
      haveSamples: input.haveSamples,
      notes: input.notes,
      lastContact: input.lastContact,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    const identity = identityFromPerson(person, row);
    row.nameSnapshot = identity.name;
    row.roleSnapshot = identity.role;
    row.contactSnapshot = identity.contact;
    const appended = await appendContactRow(clients, row);
    await ensureRowMetadata(clients, "Contacts", id);
    clearPendingContact(clients.accountSlot, id);
    if (!appended) {
      const existing = (await readContacts()).contacts.find((contact) => contact.id === id);
      if (existing) return existing;
      throw new Error("The contact row was created but could not be read back.");
    }
    await appendHistoryEntries(clients, id, input.log);
    await ensureHistoryRowMetadata(clients, id);
    return publicContact(row, identity, input.log);
  });
}

export async function updateContact(id: string, update: ContactUpdate): Promise<Contact | null> {
  if (!isValidContactId(id)) throw new Error("Contact id is invalid.");
  assertValidContactUpdate(update);
  if (usesAgentGoogleConnectors()) return updateConnectorContact(id, update);
  const clients = await googleClients();
  return queueContactMutation(clients.accountSlot, id, async () => {
    const state = await readSheetState(clients);
    const stored = state.contactRows.find((row) => row.value.id === id);
    if (!stored) return null;

    const categories = state.categories.length ? state.categories : DEFAULT_CATEGORIES;
    const requestedCategory = update.category ?? stored.value.category;
    if (!categories.some((entry) => entry.id === requestedCategory)) throw new Error("Category does not exist");

    const person = stored.value.personResourceName
      ? (await getPeopleByResource(clients.people, [stored.value.personResourceName])).get(stored.value.personResourceName)
      : undefined;
    const currentIdentity = identityFromPerson(person, stored.value);
    const requestedIdentity = {
      name: update.name?.trim() ?? currentIdentity.name,
      role: update.role ?? currentIdentity.role,
      contact: update.contact ?? currentIdentity.contact,
    };
    const identityRequested = update.name !== undefined || update.role !== undefined || update.contact !== undefined;
    const changes = {
      name: update.name !== undefined && requestedIdentity.name !== currentIdentity.name,
      role: update.role !== undefined && requestedIdentity.role !== currentIdentity.role,
      contact: update.contact !== undefined && requestedIdentity.contact !== currentIdentity.contact,
    };

    // Validate every requested value before mutating Google Contacts.
    assertValidContactSheetRow({
      ...stored.value,
      nameSnapshot: requestedIdentity.name,
      roleSnapshot: requestedIdentity.role,
      contactSnapshot: requestedIdentity.contact,
      category: requestedCategory,
      status: update.status ?? stored.value.status,
      haveSamples: update.haveSamples ?? stored.value.haveSamples,
      notes: update.notes ?? stored.value.notes,
      lastContact: update.lastContact === undefined ? stored.value.lastContact : update.lastContact,
      updatedAt: new Date().toISOString(),
    }, new Set(categories.map((entry) => entry.id)));

    let resourceName = stored.value.personResourceName;
    let resolvedPerson = person;
    let createdOrRecoveredPerson = false;
    if (resourceName && person && (changes.name || changes.role || changes.contact)) {
      resolvedPerson = await updateGoogleContact(clients.people, resourceName, id, requestedIdentity, changes);
    } else if (!person && identityRequested) {
      const claimed = new Set(
        state.contactRows
          .filter((row) => row.value.id !== id)
          .map((row) => row.value.personResourceName),
      );
      resolvedPerson = await resolveGoogleContactForCreate(
        clients.people,
        clients.accountSlot,
        id,
        requestedIdentity,
        claimed,
      );
      resourceName = resolvedPerson.resourceName as string;
      createdOrRecoveredPerson = true;
    }

    // People requests can take long enough for a Sheet refresh or human edit.
    // Re-resolve the row by its stable id and merge only this patch into the
    // newest workflow values rather than writing the earlier whole-row snapshot.
    const latest = await readSheetState(clients);
    const latestStored = latest.contactRows.find((row) => row.value.id === id);
    if (!latestStored) throw new Error("That outreach contact was removed while it was being updated.");
    if (
      latestStored.value.personResourceName !== stored.value.personResourceName &&
      latestStored.value.personResourceName !== resourceName
    ) {
      throw new Error("That outreach contact was relinked while it was being updated. Refresh and try again.");
    }
    const latestCategories = latest.categories.length ? latest.categories : DEFAULT_CATEGORIES;
    const category = update.category ?? latestStored.value.category;
    if (!latestCategories.some((entry) => entry.id === category)) throw new Error("Category does not exist");

    if (resourceName) {
      const refreshed = (await getPeopleByResource(clients.people, [resourceName])).get(resourceName);
      if (refreshed) resolvedPerson = refreshed;
    }
    const finalIdentity = identityFromPerson(resolvedPerson, {
      ...latestStored.value,
      nameSnapshot: requestedIdentity.name,
      roleSnapshot: requestedIdentity.role,
      contactSnapshot: requestedIdentity.contact,
    });
    const nextRow: ContactSheetRow = {
      ...latestStored.value,
      personResourceName: resourceName,
      nameSnapshot: finalIdentity.name,
      roleSnapshot: finalIdentity.role,
      contactSnapshot: finalIdentity.contact,
      category,
      status: update.status ?? latestStored.value.status,
      haveSamples: update.haveSamples ?? latestStored.value.haveSamples,
      notes: update.notes ?? latestStored.value.notes,
      lastContact: update.lastContact === undefined ? latestStored.value.lastContact : update.lastContact,
      updatedAt: new Date().toISOString(),
    };
    assertValidContactSheetRow(nextRow, new Set(latestCategories.map((entry) => entry.id)));
    await updateContactRow(clients, nextRow);
    const pendingIdentity = pendingContact(clients.accountSlot, id);
    if (
      createdOrRecoveredPerson ||
      (pendingIdentity?.resourceName && pendingIdentity.resourceName === nextRow.personResourceName)
    ) {
      // This also closes the recovery record when a prior filtered Sheet write
      // committed but its HTTP response was lost: the retry sees that the row
      // already points at the pending Person and can safely finish the intent.
      clearPendingContact(clients.accountSlot, id);
    }
    const log = latest.historyRows
      .filter((row) => row.value.contactId === id)
      .map((row) => ({ date: row.value.date, channel: row.value.channel, summary: row.value.summary }));
    return publicContact(nextRow, finalIdentity, log);
  });
}

export async function removeContact(id: string): Promise<Contact | null> {
  if (!isValidContactId(id)) throw new Error("Contact id is invalid.");
  if (usesAgentGoogleConnectors()) return removeConnectorContact(id);
  const clients = await googleClients();
  return queueContactMutation(clients.accountSlot, id, async () => {
    const before = await readSheetState(clients);
    const beforeRow = before.contactRows.find((row) => row.value.id === id);
    if (!beforeRow) return null;
    const people = await getPeopleByResource(clients.people, [beforeRow.value.personResourceName]);

    // Re-read the record before resolving its stable row metadata. The final
    // clear is addressed only by those locators, never by a cached row number.
    const state = await readSheetState(clients);
    const stored = state.contactRows.find((row) => row.value.id === id);
    if (!stored) return null;
    if (stored.value.personResourceName !== beforeRow.value.personResourceName) {
      throw new Error("That outreach contact was relinked while it was being removed. Refresh and try again.");
    }
    const log = state.historyRows
      .filter((row) => row.value.contactId === id)
      .map((row) => ({ date: row.value.date, channel: row.value.channel, summary: row.value.summary }));
    const contact = publicContact(
      stored.value,
      identityFromPerson(people.get(stored.value.personResourceName), stored.value),
      log,
    );
    const contactMetadataId = await ensureRowMetadata(clients, "Contacts", id);
    const historyMetadataIds = await ensureHistoryRowMetadata(clients, id);
    const metadataRows = [
      { metadataId: contactMetadataId, width: CONTACT_HEADERS.length },
      ...historyMetadataIds.map((metadataId) => ({ metadataId, width: HISTORY_HEADERS.length })),
    ];
    // One filtered values request is the delete boundary. Row metadata follows
    // a record through browser sorts, and writing only the managed columns does
    // not erase any unrelated columns a person may have added to the Sheet.
    const cleared = await clients.sheets.spreadsheets.values.batchUpdateByDataFilter({
      spreadsheetId: clients.spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        includeValuesInResponse: true,
        data: metadataRows.map(({ metadataId, width }) => ({
          dataFilter: { developerMetadataLookup: { metadataId } },
          majorDimension: "ROWS",
          values: [Array.from({ length: width }, () => "")],
        })),
      },
    });
    if (cleared.data.totalUpdatedRows !== metadataRows.length) {
      throw new Error("Google Sheets did not confirm every outreach row removal. Refresh and verify the Sheet.");
    }
    // Values are already gone if this best-effort cleanup fails. Leaving a
    // locator on a blank row is harmless and a future lazy attach can repair it.
    try {
      await deleteRowMetadata(clients, metadataRows.map((row) => row.metadataId));
    } catch {
      // No retry: the atomic clear above is the durable operation.
    }
    // Deliberately leave the Google Contact intact. A later exact-email add can
    // safely reassign its now-orphaned app marker instead of duplicating it.
    return contact;
  });
}

export async function appendContactLog(
  contactId: string,
  entry: ContactLogEntry,
  operationId = createHistoryId(),
): Promise<boolean> {
  if (!isValidContactId(contactId) || !isValidLogEntry(entry) || !isValidHistoryOperationId(operationId)) {
    throw new Error("Contact log entry is invalid.");
  }
  if (usesAgentGoogleConnectors()) return appendConnectorContactLog(contactId, entry, operationId);
  const clients = await googleClients();
  const operationKey = `${clients.accountSlot}:${operationId}`;
  const pending = historyAppendInFlight.get(operationKey);
  if (pending) return pending;

  const operation = queueContactMutation(clients.accountSlot, contactId, async () => {
    const state = await readSheetState(clients);
    const stored = state.contactRows.find((row) => row.value.id === contactId);
    if (!stored) return false;
    const completed = state.historyRows.find((row) => row.value.id === operationId)?.value;
    if (completed) {
      if (completed.contactId !== contactId || logSignature(completed) !== logSignature(entry)) {
        throw new Error("That contact-history operation id was already used for different content.");
      }
      await ensureHistoryRowMetadata(clients, contactId);
      return true;
    }
    const createdAt = new Date().toISOString();
    const historyRow = { ...entry, id: operationId, contactId, createdAt };
    assertValidHistorySheetRow(historyRow);
    await clients.sheets.spreadsheets.values.append({
      spreadsheetId: clients.spreadsheetId,
      range: HISTORY_RANGE,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [serializeHistoryRow(historyRow)],
      },
    });
    await ensureHistoryRowMetadata(clients, contactId);
    try {
      const latest = await readSheetState(clients);
      const latestStored = latest.contactRows.find((row) => row.value.id === contactId);
      if (latestStored) {
        await updateContactRow(clients, {
          ...latestStored.value,
          updatedAt: createdAt,
        });
      }
    } catch {
      // The append above is already durable. Treat timestamp refresh as
      // best-effort so callers never retry and duplicate correspondence history.
    }
    return true;
  });
  historyAppendInFlight.set(operationKey, operation);
  try {
    return await operation;
  } finally {
    if (historyAppendInFlight.get(operationKey) === operation) historyAppendInFlight.delete(operationKey);
  }
}

async function listGoogleContacts(people: people_v1.People) {
  const contacts: people_v1.Schema$Person[] = [];
  let pageToken: string | undefined;
  do {
    const response = await people.people.connections.list({
      resourceName: "people/me",
      pageSize: 1000,
      pageToken,
      personFields: PERSON_FIELDS,
      sources: ["READ_SOURCE_TYPE_CONTACT"],
    });
    contacts.push(...(response.data.connections ?? []));
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  return contacts;
}

function safelyMatchedPerson(
  all: people_v1.Schema$Person[],
  contact: Contact,
  claimedResourceNames: ReadonlySet<string>,
) {
  const conflicted = all.filter((person) => {
    const ids = appFieldValues(person, APP_FIELD_ID);
    return ids.includes(contact.id) && ids.some((id) => id !== contact.id);
  });
  if (conflicted.length) {
    throw new Error(`A Google Contact carries conflicting Studio Assistant ids for ${contact.id}.`);
  }
  const byAppId = all.filter((person) =>
    person.resourceName && appFieldValues(person, APP_FIELD_ID).includes(contact.id),
  );
  if (byAppId.length > 1) {
    throw new Error(`More than one Google Contact is marked for legacy contact ${contact.id}.`);
  }
  if (byAppId.length === 1) {
    const resourceName = byAppId[0].resourceName as string;
    if (claimedResourceNames.has(resourceName)) {
      throw new Error(`Google Contact ${resourceName} is already claimed by another outreach record.`);
    }
    return byAppId[0];
  }
  const email = normalizedEmail(contact.contact);
  if (!email) return undefined;
  const byEmail = all.filter(
    (person) =>
      Boolean(person.resourceName) &&
      !claimedResourceNames.has(person.resourceName as string) &&
      appFieldValues(person, APP_FIELD_ID).length === 0 &&
      person.emailAddresses?.some((entry) => normalizedEmail(entry.value ?? "") === email),
  );
  return byEmail.length === 1 ? byEmail[0] : undefined;
}

function logSignature(entry: ContactLogEntry) {
  return `${entry.date}\u0000${entry.channel}\u0000${entry.summary.trim()}`;
}

async function appendHistoryEntries(
  clients: Awaited<ReturnType<typeof googleClients>>,
  contactId: string,
  entries: ContactLogEntry[],
) {
  if (!entries.length) return;
  if (!isValidContactId(contactId) || !isValidLog(entries)) {
    throw new Error("Contact history is invalid.");
  }
  const createdAt = new Date().toISOString();
  const rows = entries.map((entry) => ({ ...entry, id: createHistoryId(), contactId, createdAt }));
  rows.forEach(assertValidHistorySheetRow);
  await clients.sheets.spreadsheets.values.append({
    spreadsheetId: clients.spreadsheetId,
    range: HISTORY_RANGE,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows.map(serializeHistoryRow),
    },
  });
}

export type LegacyContactsImportResult = {
  imported: number;
  matched: number;
  created: number;
  skipped: number;
  source: string;
};

/**
 * Import the old contacts.json once Google is connected. Stable app ids and a
 * marker on the Google Contact make retries safe after a partial failure. The
 * local file is intentionally left untouched as a recoverable backup.
 */
export async function importLegacyContacts(): Promise<LegacyContactsImportResult> {
  const source = dataPath("contacts", "contacts.json");
  let legacy: Contacts;
  try {
    const value: unknown = JSON.parse(fs.readFileSync(source, "utf8"));
    if (!isValidContacts(value)) throw new Error("Legacy contacts data is invalid.");
    legacy = value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // Starter/example contacts are documentation, not artist data. A missing
    // personal store is an intentional zero-item migration.
    return { imported: 0, matched: 0, created: 0, skipped: 0, source };
  }

  if (usesAgentGoogleConnectors()) return importLegacyContactsConnector(legacy, source);

  const clients = await googleClients();
  return queueContactMutation(clients.accountSlot, "migration", async () => {
  const state = await readSheetState(clients);
  const existingIds = new Set(state.contactRows.map((row) => row.value.id));
  const claimedResourceNames = new Set(
    state.contactRows.map((row) => row.value.personResourceName).filter(Boolean),
  );
  const historyByContact = new Map<string, Set<string>>();
  for (const row of state.historyRows) {
    const signatures = historyByContact.get(row.value.contactId) ?? new Set<string>();
    signatures.add(logSignature(row.value));
    historyByContact.set(row.value.contactId, signatures);
  }
  const people = await listGoogleContacts(clients.people);
  let imported = 0;
  let matched = 0;
  let created = 0;
  let skipped = 0;

  const mergedCategories = [...(state.categories.length ? state.categories : DEFAULT_CATEGORIES)];
  for (const category of legacy.categories) {
    if (!mergedCategories.some((entry) => entry.id === category.id)) mergedCategories.push(category);
  }
  await writeCategories(clients, mergedCategories);

  for (const contact of legacy.contacts) {
    const existingHistory = historyByContact.get(contact.id) ?? new Set<string>();
    const missingHistory = contact.log.filter((entry) => !existingHistory.has(logSignature(entry)));
    if (existingIds.has(contact.id)) {
      await ensureRowMetadata(clients, "Contacts", contact.id);
      await appendHistoryEntries(clients, contact.id, missingHistory);
      await ensureHistoryRowMetadata(clients, contact.id);
      clearPendingContact(clients.accountSlot, contact.id);
      for (const entry of missingHistory) existingHistory.add(logSignature(entry));
      historyByContact.set(contact.id, existingHistory);
      skipped += 1;
      continue;
    }
    let person = await recoverPendingGoogleContact(
      clients.people,
      clients.accountSlot,
      contact.id,
      contact,
      claimedResourceNames,
    );
    if (!person) person = safelyMatchedPerson(people, contact, claimedResourceNames);
    if (person?.resourceName) {
      matched += 1;
      // Google is canonical for an existing identity. Add only our stable
      // marker (and a missing custom role/contact); never replace its name,
      // email addresses, phone numbers, or organizations during import.
      person = await markMatchedGoogleContact(clients.people, person.resourceName, contact.id, contact);
    } else {
      person = await createGoogleContactWithIntent(
        clients.people,
        clients.accountSlot,
        contact.id,
        contact,
        claimedResourceNames,
      );
      people.push(person);
      created += 1;
    }
    if (!person.resourceName) throw new Error("Google Contacts returned a contact without an id.");
    if (claimedResourceNames.has(person.resourceName)) {
      throw new Error(`Google Contact ${person.resourceName} is already claimed by another outreach record.`);
    }
    claimedResourceNames.add(person.resourceName);
    savePendingContactResource(clients.accountSlot, contact.id, person.resourceName);
    const importedIdentity = identityFromPerson(person, {
      id: contact.id,
      personResourceName: person.resourceName as string,
      nameSnapshot: contact.name,
      roleSnapshot: contact.role,
      contactSnapshot: contact.contact,
      category: contact.category,
      status: contact.status,
      haveSamples: contact.haveSamples,
      notes: contact.notes,
      lastContact: contact.lastContact,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    });
    const row: ContactSheetRow = {
      id: contact.id,
      personResourceName: person.resourceName as string,
      nameSnapshot: importedIdentity.name,
      roleSnapshot: importedIdentity.role,
      contactSnapshot: importedIdentity.contact,
      category: contact.category,
      status: contact.status,
      haveSamples: contact.haveSamples,
      notes: contact.notes,
      lastContact: contact.lastContact,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    };
    const appended = await appendContactRow(clients, row);
    await ensureRowMetadata(clients, "Contacts", contact.id);
    clearPendingContact(clients.accountSlot, contact.id);
    await appendHistoryEntries(clients, contact.id, missingHistory);
    await ensureHistoryRowMetadata(clients, contact.id);
    for (const entry of missingHistory) existingHistory.add(logSignature(entry));
    historyByContact.set(contact.id, existingHistory);
    existingIds.add(contact.id);
    if (appended) imported += 1;
    else skipped += 1;
  }

  return { imported, matched, created, skipped, source };
  });
}

export const OUTREACH_SHEET_SCHEMA = {
  Contacts: [...CONTACT_HEADERS],
  History: [...HISTORY_HEADERS],
  Categories: [...CATEGORY_HEADERS],
} as const;
