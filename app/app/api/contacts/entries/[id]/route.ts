import { NextResponse } from "next/server";
import {
  isValidLastContact,
  isValidStatus,
  removeContact,
  updateContact,
} from "@/lib/contacts";
import type { ContactStatus } from "@/lib/contacts";

type UpdateContactBody = {
  name?: unknown;
  role?: unknown;
  category?: unknown;
  status?: unknown;
  haveSamples?: unknown;
  contact?: unknown;
  notes?: unknown;
  lastContact?: unknown;
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
    (body.lastContact !== undefined && body.lastContact !== "" && !isValidLastContact(body.lastContact))
  ) {
    return NextResponse.json({ error: "Contact update is invalid" }, { status: 400 });
  }

  try {
    const entry = await updateContact(id, {
      ...(body.name !== undefined ? { name: (body.name as string).trim() } : {}),
      ...(body.role !== undefined ? { role: body.role as string } : {}),
      ...(body.category !== undefined ? { category: body.category as string } : {}),
      ...(body.status !== undefined ? { status: body.status as ContactStatus } : {}),
      ...(body.haveSamples !== undefined ? { haveSamples: body.haveSamples as boolean } : {}),
      ...(body.contact !== undefined ? { contact: body.contact as string } : {}),
      ...(body.notes !== undefined ? { notes: body.notes as string } : {}),
      ...(body.lastContact !== undefined
        ? { lastContact: body.lastContact === "" ? null : (body.lastContact as string | null) }
        : {}),
    });
    if (!entry) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    return NextResponse.json(entry);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update contact";
    return NextResponse.json({ error: message }, { status: message === "Category does not exist" ? 400 : 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const deletedEntry = await removeContact(id);
    if (!deletedEntry) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    return NextResponse.json(deletedEntry);
  } catch {
    return NextResponse.json({ error: "Unable to remove contact from outreach" }, { status: 500 });
  }
}
