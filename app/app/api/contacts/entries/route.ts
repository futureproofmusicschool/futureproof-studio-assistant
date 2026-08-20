import { NextResponse } from "next/server";
import {
  createContact,
  isValidContactId,
  isValidLastContact,
  isValidLog,
  isValidStatus,
} from "@/lib/contacts";

type CreateContactBody = {
  id?: unknown;
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
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Contact data must be a JSON object" }, { status: 400 });
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
    (body.id !== undefined && !isValidContactId(body.id)) ||
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
    const entry = await createContact({
      ...(typeof body.id === "string" ? { id: body.id } : {}),
      name,
      role,
      category: body.category,
      status,
      haveSamples,
      contact,
      notes,
      lastContact,
      log,
    });
    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create contact";
    return NextResponse.json({ error: message }, { status: message === "Category does not exist" ? 400 : 500 });
  }
}
