import { readPreset } from "@/lib/pod-hd/library";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: {params: Promise<{id: string}>}) {
  try {
    const { id } = await params;
    return new Response(new Uint8Array(readPreset(id)), { headers: {
      "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="preset-${id}.hbe"`, "Cache-Control": "no-store",
    } });
  } catch { return Response.json({error: "Preset not found."}, {status: 404}); }
}
