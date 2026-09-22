import { NextResponse } from "next/server";
import { startFiling } from "@/lib/filing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = startFiling(new URL(request.url).searchParams.get("auto") === "1");
    // Only the worker commits completion. Returning early never advances it.
    void work.catch(() => console.error("[bookkeeping] Filing failed; retained for retry."));
    const result = await Promise.race([
      work.then((filed) => ({ filed, filing: false })),
      new Promise<{ filed: string[]; filing: boolean }>((resolve) => {
        timer = setTimeout(() => resolve({ filed: [], filing: true }), 12_000);
      }),
    ]);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not file the conversation." }, { status: 500 });
  } finally { clearTimeout(timer); }
}
