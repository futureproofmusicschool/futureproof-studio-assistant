import { NextResponse } from "next/server";
import { listDocuments, writeDocument } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ documents: await listDocuments() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read documents" },
      { status: 500 },
    );
  }
}

/** Create a document from the Docs tab. Anything the artist writes is source "you". */
export async function POST(request: Request) {
  let body: { title?: unknown; body?: unknown; operationId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Document data must be a JSON object" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "A document needs a title." }, { status: 400 });

  try {
    // The browser keeps one operation id for a submit/retry cycle. A later
    // intentional create gets a new id even when its title is identical.
    const document = await writeDocument({
      title,
      body: typeof body.body === "string" ? body.body : "",
      source: "you",
      operationId: typeof body.operationId === "string" ? body.operationId : undefined,
    });
    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to write document" },
      { status: 400 },
    );
  }
}
