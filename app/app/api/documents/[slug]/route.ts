import { NextResponse } from "next/server";
import { deleteDocument, readDocument, writeDocument } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, context: Context) {
  const { slug } = await context.params;
  try {
    const document = await readDocument(slug);
    if (!document) return NextResponse.json({ error: "No such document" }, { status: 404 });
    return NextResponse.json(document);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read document" },
      { status: 500 },
    );
  }
}

/** Programmatic update path. People edit through the native Google Docs UI. */
export async function PUT(request: Request, context: Context) {
  const { slug } = await context.params;

  let body: {
    title?: unknown;
    body?: unknown;
    mode?: unknown;
    source?: unknown;
    operationId?: unknown;
    expectedRevisionId?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Document data must be a JSON object" }, { status: 400 });
  }

  if (typeof body.body !== "string") {
    return NextResponse.json({ error: "body must be a string" }, { status: 400 });
  }

  try {
    const existing = await readDocument(slug);
    if (!existing) return NextResponse.json({ error: "No such document" }, { status: 404 });
    return NextResponse.json(
      await writeDocument({
        id: slug,
        title: typeof body.title === "string" ? body.title.trim() : undefined,
        body: body.body,
        mode: body.mode === "append" ? "append" : "replace",
        operationId: typeof body.operationId === "string" ? body.operationId : undefined,
        expectedRevisionId:
          typeof body.expectedRevisionId === "string" ? body.expectedRevisionId : undefined,
        source:
          body.source === "assistant" || body.source === "you" || body.source === "deep-research"
            ? body.source
            : undefined,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save document" },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { slug } = await context.params;
  try {
    if (!(await deleteDocument(slug))) {
      return NextResponse.json({ error: "No such document" }, { status: 404 });
    }
    return NextResponse.json({ deleted: slug });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to move document to trash" },
      { status: 500 },
    );
  }
}
