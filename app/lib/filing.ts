import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atomicWrite, readJson, writeJson } from "./runtime/files.js";
import { fileTranscript } from "./bookkeeping";
import { readAssistantConfig } from "./config";
import { DATA_ROOT, readTurns, readState, patchState, compactAfterFiling, type ConversationTurn } from "./conversation-store";

type Job = { id: string; day: string; lastTurnId: string; transcript: string; status: "pending" | "complete" };
type Journal = { version: 1; jobs: Job[] };
const JOURNAL = path.join(DATA_ROOT, "conversation", "filing.json");
const runtime = globalThis as typeof globalThis & { studioFiling?: Promise<string[]> };
export function dayOf(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function archive(day: string, turns: ConversationTurn[], names: { name: string; userName: string }) {
  const target = path.join(DATA_ROOT, "conversation", "transcripts", `${day}.md`);
  const ledger = path.join(DATA_ROOT, "conversation", "transcripts", ".turns", `${day}.json`);
  const stored = readJson<{ legacy: string; turns: ConversationTurn[] } | null>(ledger, null);
  const old = stored ?? { legacy: fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "", turns: [] };
  const merged = new Map(old.turns.map((turn) => [turn.id, turn]));
  turns.forEach((turn) => merged.set(turn.id, turn));
  const next = { legacy: old.legacy, turns: Array.from(merged.values()) };
  writeJson(ledger, next);
  const text = next.turns.filter((turn) => turn.role !== "tool").map((turn) =>
    `**${turn.role === "assistant" ? names.name : names.userName}:** ${turn.attachment ? `[${turn.attachment.kind}: ${turn.attachment.name}] ` : ""}${turn.text}`,
  ).join("\n\n");
  atomicWrite(target, `${old.legacy || `# Conversation\n\nDate: ${day}\n`}\n\n${text}\n`);
  return `conversation/transcripts/${day}.md`;
}

async function run(auto: boolean) {
  const journal = readJson<Journal>(JOURNAL, { version: 1, jobs: [] });
  if (journal.version !== 1 || !Array.isArray(journal.jobs)) throw new Error("Filing journal is invalid.");
  const filed: string[] = [];
  const finish = async (job: Job) => {
    // The bookkeeping operation stores its model payload before applying it.
    // Replaying after a crash is a deterministic write, not another memory note.
    await fileTranscript(job.transcript, job.id);
    job.status = "complete";
    writeJson(JOURNAL, journal);
    patchState({ lastFiledTurnId: job.lastTurnId, lastFiledDay: job.day });
    compactAfterFiling();
    filed.push(job.day);
  };
  // Recover the marker if a previous process stopped after the receipt write.
  const last = [...journal.jobs].reverse().find((job) => job.status === "complete");
  const pending = journal.jobs.filter((job) => job.status === "pending");
  if (last && !pending.length) patchState({ lastFiledTurnId: last.lastTurnId, lastFiledDay: last.day });
  for (const job of pending) await finish(job); // A failure stops the cursor here.

  const state = readState();
  const all = readTurns({ limit: 0 });
  const marker = state.lastFiledTurnId ? all.findIndex((turn) => turn.id === state.lastFiledTurnId) : -1;
  const today = dayOf(Date.now());
  const unfiled = all.slice(marker + 1).filter((turn) => !auto || dayOf(turn.createdAt) < today);
  const byDay = new Map<string, ConversationTurn[]>();
  for (const turn of unfiled) {
    const day = dayOf(turn.createdAt);
    const list = byDay.get(day) ?? [];
    list.push(turn);
    byDay.set(day, list);
  }
  const names = readAssistantConfig();
  for (const [day, turns] of Array.from(byDay.entries())) {
    const id = crypto.createHash("sha256").update(turns.map((turn) => turn.id).join("\n")).digest("hex");
    const transcript = archive(day, turns, names);
    const job: Job = { id, day, lastTurnId: turns[turns.length - 1].id, transcript, status: "pending" };
    journal.jobs.push(job);
    writeJson(JOURNAL, journal);
    await finish(job);
  }
  return filed;
}

export function startFiling(auto: boolean): Promise<string[]> {
  if (runtime.studioFiling) return runtime.studioFiling;
  const operation = run(auto);
  runtime.studioFiling = operation;
  void operation.finally(() => { if (runtime.studioFiling === operation) runtime.studioFiling = undefined; }).catch(() => {});
  return operation;
}
