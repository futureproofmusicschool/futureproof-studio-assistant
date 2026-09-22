import crypto from "node:crypto";
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CONTACT_ID_PATTERN = /^k_[a-z0-9]{8,64}$/i;
const HISTORY_OPERATION_ID_PATTERN = /^h_[a-f0-9]{32}$/i;
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isIsoDateOrNull(value: unknown): value is string | null {
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

export function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function isValidCategories(value: unknown): value is ContactCategory[] {
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

export function isValidContactValue(value: unknown, categoryIds: ReadonlySet<string>): value is Contact {
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

export function assertValidContactInput(input: ContactInput) {
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

export function assertValidContactUpdate(update: ContactUpdate) {
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

