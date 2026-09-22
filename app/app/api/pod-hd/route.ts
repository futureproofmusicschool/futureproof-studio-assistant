import { NextResponse } from "next/server";
import { createChain, createVariation, editorStatus, listPresets, openInEditor, savePreset, verifyReadback } from "@/lib/pod-hd/library";
import { mappingStatus } from "@/lib/pod-hd/chain";
import { PRESET_BYTES } from "@/lib/pod-hd/preset";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json({ presets: listPresets(), editor: editorStatus(), mapping: mappingStatus() }); }
  catch { return NextResponse.json({ error: "Could not read the preset library." }, { status: 500 }); }
}
async function limitedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 16_384) { await reader.cancel(); throw new Error("Preset request is too large."); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function POST(request: Request) {
  if (request.headers.get("x-studio-assistant-action") !== "pod-hd") return NextResponse.json({ error: "Missing action header." }, { status: 403 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  try {
    const bytes = await limitedBody(request);
    if (request.headers.get("content-type") === "application/octet-stream") {
      if (bytes.length !== PRESET_BYTES) throw new Error("Expected one .hbe preset, not a bundle or setlist.");
      const id = new URL(request.url).searchParams.get("verify");
      return NextResponse.json(id ? verifyReadback(id, bytes) : savePreset(bytes));
    }
    const body = JSON.parse(bytes.toString("utf8"));
    if (body.action === "create") return NextResponse.json(createVariation(body.id, body.edits));
    if (body.action === "chain") return NextResponse.json(createChain(body.id, body.recipe));
    if (body.action === "open") return NextResponse.json(await openInEditor(body.id));
    throw new Error("Unknown preset action.");
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Preset operation failed." }, { status: 400 }); }
}
