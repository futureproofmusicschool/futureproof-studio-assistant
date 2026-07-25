import { NextResponse } from "next/server";
import {
  createContactId,
  isValidLastContact,
  isValidLog,
  isValidStatus,
  readContacts,
  writeContacts,
} from "@/lib/contacts";

type CreateContactBody = {
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

export async function POST(request: Request) {
  let body: CreateContactBody;
  try {
    body = (await request.json()) as CreateContactBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const role = body.role === undefined ? "" : body.role;
  const status = body.status === undefined ? "to-contact" : body.status;
  const haveSamples = body.haveSamples === undefined ? false : body.haveSamples;
  const contact = body.contact === undefined ? "" : body.contact;
  const notes = body.notes === undefined ? "" : body.notes;
  const lastContact = body.lastContact === undefined || body.lastContact === "" ? null : body.lastContact;
  const log = body.log === undefined ? [] : body.log;

  if (
    !name ||
    typeof body.category !== "string" ||
    typeof role !== "string" ||
    !isValidStatus(status) ||
    typeof haveSamples !== "boolean" ||
    typeof contact !== "string" ||
    typeof notes !== "string" ||
    !isValidLastContact(lastContact) ||
    !isValidLog(log)
  ) {
    return NextResponse.json({ error: "Contact data is invalid" }, { status: 400 });
  }

  try {
    const contacts = readContacts();
    if (!contacts.categories.some((category) => category.id === body.category)) {
      return NextResponse.json({ error: "Category does not exist" }, { status: 400 });
    }

    const timestamp = new Date().toISOString();
    const entry = {
      id: createContactId(),
      name,
      role,
      category: body.category,
      status,
      haveSamples,
      contact,
      notes,
      lastContact,
      log,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    contacts.contacts.push(entry);
    writeContacts(contacts);
    return NextResponse.json(entry, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to create contact" }, { status: 500 });
  }
}
