import { NextResponse } from "next/server";
import { checkDeepResearch, listResearchJobs } from "@/lib/research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Chat tab's research poll. GET lists jobs; GET ?id= polls one job on
 * Google's side (and files the report the moment it is done), so the UI can
 * keep a "research running" chip honest without the model in the loop.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");

  try {
    if (!id) return NextResponse.json({ jobs: listResearchJobs() });
    return NextResponse.json({ job: await checkDeepResearch(id) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not check the research job." },
      { status: 500 },
    );
  }
}
