import { NextResponse } from "next/server";
import {
  isValidLastContact,
  isValidLog,
  isValidStatus,
  readContacts,
  writeContacts,
} from "@/lib/contacts";
import type { ContactLogEntry, ContactStatus } from "@/lib/contacts";

type UpdateContactBody = {
  name?: unknown;
  role?: unknown;
  category?: unknown;
  status?: unknown;
  haveSamples?: unknown;
  contact?: unknown;
  notes?: unknown;
  lastContact?: unknown;
  log?: unknown;
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

const allowedKeys = new Set([
  "name",
  "role",
  "category",
  "status",
  "haveSamples",
  "contact",
  "notes",
  "lastContact",
  "log",
]);

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  let body: UpdateContactBody;
  try {
    body = (await request.json()) as UpdateContactBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Object.keys(body).some((key) => !allowedKeys.has(key)) ||
    (body.name !== undefined && (typeof body.name !== "string" || body.name.trim() === "")) ||
    (body.role !== undefined && typeof body.role !== "string") ||
    (body.category !== undefined && typeof body.category !== "string") ||
    (body.status !== undefined && !isValidStatus(body.status)) ||
    (body.haveSamples !== undefined && typeof body.haveSamples !== "boolean") ||
    (body.contact !== undefined && typeof body.contact !== "string") ||
    (body.notes !== undefined && typeof body.notes !== "string") ||
    (body.lastContact !== undefined && body.lastContact !== "" && !isValidLastContact(body.lastContact)) ||
    (body.log !== undefined && !isValidLog(body.log))
  ) {
    return NextResponse.json({ error: "Contact update is invalid" }, { status: 400 });
  }

  try {
    const contacts = readContacts();
    const entry = contacts.contacts.find((item) => item.id === id);
    if (!entry) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

    if (
      body.category !== undefined &&
      !contacts.categories.some((category) => category.id === body.category)
    ) {
      return NextResponse.json({ error: "Category does not exist" }, { status: 400 });
    }

    if (body.name !== undefined) entry.name = (body.name as string).trim();
    if (body.role !== undefined) entry.role = body.role as string;
    if (body.category !== undefined) entry.category = body.category as string;
    if (body.status !== undefined) entry.status = body.status as ContactStatus;
    if (body.haveSamples !== undefined) entry.haveSamples = body.haveSamples as boolean;
    if (body.contact !== undefined) entry.contact = body.contact as string;
    if (body.notes !== undefined) entry.notes = body.notes as string;
    if (body.lastContact !== undefined) {
      entry.lastContact = body.lastContact === "" ? null : (body.lastContact as string | null);
    }
    if (body.log !== undefined) entry.log = body.log as ContactLogEntry[];
    entry.updatedAt = new Date().toISOString();

    writeContacts(contacts);
    return NextResponse.json(entry);
  } catch {
    return NextResponse.json({ error: "Unable to update contact" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const contacts = readContacts();
    const entryIndex = contacts.contacts.findIndex((entry) => entry.id === id);
    if (entryIndex === -1) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const [deletedEntry] = contacts.contacts.splice(entryIndex, 1);
    writeContacts(contacts);
    return NextResponse.json(deletedEntry);
  } catch {
    return NextResponse.json({ error: "Unable to delete contact" }, { status: 500 });
  }
}
