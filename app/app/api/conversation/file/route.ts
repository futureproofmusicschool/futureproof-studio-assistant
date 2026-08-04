import { NextResponse } from "next/server";
import { fileTranscript } from "@/lib/bookkeeping";
import { readAssistantConfig } from "@/lib/config";
import {
  compactAfterFiling,
  patchState,
  readState,
  readTurns,
  type ConversationTurn,
} from "@/lib/conversation-store";
import { dayStamp, writeTranscript, type TalkTurn } from "@/lib/talk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Filing the rolling thread into memory.
 *
 * There is no session end any more, so this runs on a clock: the server calls
 * it hourly with ?auto=1, which files whole days that are already over. The
 * artist can also press the button, which files everything up to now.
 *
 * A day's markdown is written before the bookkeeper is asked to read it, so a
 * failed filing costs a memory note, never the record of the conversation.
 */

const FILING_WAIT_MS = 12_000;

export async function POST(request: Request) {
  const auto = new URL(request.url).searchParams.get("auto") === "1";

  try {
    const state = readState();
    const all = readTurns({ limit: 0 });

    const lastFiledIndex = state.lastFiledTurnId
      ? all.findIndex((turn) => turn.id === state.lastFiledTurnId)
      : -1;
    let unfiled = all.slice(lastFiledIndex + 1);

    if (auto) {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      unfiled = unfiled.filter((turn) => turn.createdAt < startOfToday.getTime());
    }

    if (unfiled.length === 0) {
      return NextResponse.json({ filed: [], filing: false, note: "Nothing new to file." });
    }

    const config = readAssistantConfig();
    const byDay = new Map<string, ConversationTurn[]>();
    for (const turn of unfiled) {
      const day = dayStamp(new Date(turn.createdAt));
      byDay.set(day, [...(byDay.get(day) ?? []), turn]);
    }

    const filed: string[] = [];
    let stillFiling = false;
    let lastFiledTurnId = state.lastFiledTurnId ?? null;
    let lastFiledDay = state.lastFiledDay ?? null;

    for (const [day, turns] of Array.from(byDay.entries())) {
      const speakerTurns: TalkTurn[] = turns
        .filter((turn) => turn.role !== "tool")
        .map((turn) => ({
          speaker: turn.role === "assistant" ? config.name : config.userName,
          text: turn.attachment ? `[${turn.attachment.kind}: ${turn.attachment.name}] ${turn.text}` : turn.text,
        }));

      const savedPath = writeTranscript(speakerTurns, new Date(`${day}T12:00:00`), "conversation");
      if (!savedPath) continue;

      const filing = fileTranscript(savedPath).catch((error: unknown) => {
        console.error(`[bookkeeping] could not file ${savedPath}:`, error);
        return null;
      });
      const timeout = new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), FILING_WAIT_MS));
      const outcome = await Promise.race([filing, timeout]);

      if (outcome === "pending") {
        stillFiling = true;
      } else if (outcome === null) {
        // Leave the marker where it is so the next run retries this day.
        continue;
      } else {
        filed.push(day);
      }

      lastFiledTurnId = turns[turns.length - 1].id;
      lastFiledDay = day;
    }

    if (lastFiledTurnId !== (state.lastFiledTurnId ?? null)) {
      patchState({ lastFiledTurnId, lastFiledDay });
      compactAfterFiling();
    }

    return NextResponse.json({ filed, filing: stillFiling });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not file the conversation." },
      { status: 500 },
    );
  }
}
