import crypto from "node:crypto";
import fs from "node:fs";
import { repoPath } from "@/lib/paths";

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

export type ContactCategory = {
  id: string;
  name: string;
};

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

const CONTACTS_PATH = repoPath("contacts", "contacts.json");
const TEMP_PATH = `${CONTACTS_PATH}.tmp`;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIsoDateOrNull(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value.length === 0) return false;
  return !Number.isNaN(Date.parse(value));
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

export function isValidContacts(value: unknown): value is Contacts {
  if (!isRecord(value) || value.version !== 1) return false;
  if (!Array.isArray(value.categories) || !Array.isArray(value.contacts)) return false;

  const categoryIds = new Set<string>();
  for (const category of value.categories) {
    if (
      !isRecord(category) ||
      typeof category.id !== "string" ||
      category.id.length === 0 ||
      typeof category.name !== "string" ||
      categoryIds.has(category.id)
    ) {
      return false;
    }
    categoryIds.add(category.id);
  }

  const contactIds = new Set<string>();
  for (const contact of value.contacts) {
    if (
      !isRecord(contact) ||
      typeof contact.id !== "string" ||
      contactIds.has(contact.id) ||
      typeof contact.name !== "string" ||
      contact.name.length === 0 ||
      typeof contact.role !== "string" ||
      typeof contact.category !== "string" ||
      !categoryIds.has(contact.category) ||
      !isValidStatus(contact.status) ||
      typeof contact.haveSamples !== "boolean" ||
      typeof contact.contact !== "string" ||
      typeof contact.notes !== "string" ||
      !isIsoDateOrNull(contact.lastContact) ||
      !isValidLog(contact.log) ||
      typeof contact.createdAt !== "string" ||
      Number.isNaN(Date.parse(contact.createdAt)) ||
      typeof contact.updatedAt !== "string" ||
      Number.isNaN(Date.parse(contact.updatedAt))
    ) {
      return false;
    }
    contactIds.add(contact.id);
  }

  return true;
}

export function readContacts(): Contacts {
  const value: unknown = JSON.parse(fs.readFileSync(CONTACTS_PATH, "utf8"));
  if (!isValidContacts(value)) throw new Error("contacts/contacts.json is invalid");
  return value;
}

export function writeContacts(contacts: Contacts) {
  fs.writeFileSync(TEMP_PATH, `${JSON.stringify(contacts, null, 2)}\n`, "utf8");
  fs.renameSync(TEMP_PATH, CONTACTS_PATH);
}

export function createContactId() {
  const bytes = crypto.randomBytes(8);
  const suffix = Array.from(bytes, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
  return `k_${suffix}`;
}

export function isValidLastContact(value: unknown) {
  return isIsoDateOrNull(value);
}
