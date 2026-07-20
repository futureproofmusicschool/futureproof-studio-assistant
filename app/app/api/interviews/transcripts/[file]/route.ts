import fs from "node:fs";
import { NextResponse } from "next/server";
import { resolveTranscriptPath } from "@/lib/interviews";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  try {
    const { file } = await context.params;
    const transcriptPath = resolveTranscriptPath(file);
    const contents = fs.readFileSync(transcriptPath, "utf8");
    return NextResponse.json({ file, contents });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    const status = code === "ENOENT" ? 404 : 400;
    return NextResponse.json({ error: "Transcript not found." }, { status });
  }
}
