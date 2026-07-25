import fs from "node:fs";
import path from "node:path";
import { readBoard } from "@/lib/board";
import { readContacts } from "@/lib/contacts";
import { repoPath } from "@/lib/paths";
import { FUNCTION_DECLARATIONS } from "@/lib/talk-tools";

export const LIVE_MODEL = "models/gemini-3.1-flash-live-preview";
export const LIVE_VOICE = "Algenib";

const TEMPLATES_DIR = repoPath("interviews", "templates");
export const TRANSCRIPTS_DIR = repoPath("voice", "transcripts");
const VOICE_PROMPT_PATH = repoPath("voice", "prompt.md");
const WORKING_SELF_PATH = repoPath("memory", "working-self.md");
const TEMPLATE_HEADER = /^<!--\s*title:\s*(.*?)\s*\|\s*desc:\s*(.*?)\s*-->\s*\n?/;
const TEMPLATE_ID = /^[a-z0-9-]+$/;

export const OPEN_MODE = { id: "open", name: "Open conversation", description: "Whatever is on your mind." };

export type TalkMode = { id: string; name: string; description: string };

export type TalkTurn = { speaker: string; text: string };

const RETRIEVAL_POLICY = `HOW TO USE WHAT YOU HAVE
You already hold the working-self snapshot, the board, and the contacts digest above; answer from them directly. For anything deeper (past sessions, taste notes, procedures, old transcripts, a contact's full history) call search_studio_files first, then read_studio_file on the best hit. For facts about the outside world (dates, releases, people, venues) use search. Never guess at file contents or claim a memory you have not retrieved. If retrieval finds nothing, say so.

You can also draft an email with draft_email. It writes a file to outbox/ and never sends anything; say so when you use it, and say where the draft landed.`;

function readTemplateSource(id: string) {
  if (!TEMPLATE_ID.test(id)) throw new Error("Unknown session mode.");

  const templatePath = path.join(TEMPLATES_DIR, `${id}.md`);
  if (!fs.existsSync(templatePath)) throw new Error("Unknown session mode.");

  return fs.readFileSync(templatePath, "utf8");
}

export function listTalkModes(): TalkMode[] {
  const templates = fs
    .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const id = entry.name.slice(0, -3);
      const match = readTemplateSource(id).match(TEMPLATE_HEADER);
      if (!match) {
        throw new Error(`Session mode ${entry.name} is missing its metadata comment.`);
      }
      return { id, name: match[1], description: match[2] };
    });

  return [OPEN_MODE, ...templates];
}

function modePurpose(id: string, assistantName: string) {
  if (id === OPEN_MODE.id) return "";

  const source = readTemplateSource(id).replace(TEMPLATE_HEADER, "").trim();
  return source
    .replaceAll("{name}", () => assistantName)
    .replaceAll("{topic}", () => "whatever the artist raises at the start of this session");
}

function boardDigest() {
  try {
    const board = readBoard();
    const byList = new Map(board.lists.map((list) => [list.id, list.name]));
    const counts = board.lists
      .map((list) => `${list.name} ${board.cards.filter((card) => card.list === list.id).length}`)
      .join(", ");
    const live = board.cards
      .filter((card) => card.list === "today" || card.list === "in-progress")
      .sort((a, b) => a.pos - b.pos)
      .map((card) => `- ${byList.get(card.list)}: ${card.title}`);

    return [`Board card counts: ${counts}.`, ...(live.length ? ["Committed right now:", ...live] : [])].join("\n");
  } catch {
    return "The board could not be read this session.";
  }
}

function contactsDigest() {
  try {
    const contacts = readContacts();
    return contacts.categories
      .map((category) => {
        const rows = contacts.contacts
          .filter((contact) => contact.category === category.id)
          .map((contact) => {
            const last = contact.lastContact ? contact.lastContact.slice(0, 10) : "never contacted";
            return `- ${contact.name} (${contact.id}), ${contact.status}, ${last}`;
          });
        return [`${category.name}:`, ...(rows.length ? rows : ["- (nobody yet)"])].join("\n");
      })
      .join("\n");
  } catch {
    return "The contacts file could not be read this session.";
  }
}

function readOrEmpty(filePath: string) {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

export function buildSystemInstruction(modeId: string, assistantName: string) {
  const base = readOrEmpty(VOICE_PROMPT_PATH);
  const workingSelf = readOrEmpty(WORKING_SELF_PATH);
  const purpose = modePurpose(modeId, assistantName);

  return [
    base,
    workingSelf ? `## Working self (current state)\n\n${workingSelf}` : "",
    `## Board right now\n\n${boardDigest()}`,
    `## Outreach right now\n\n${contactsDigest()}`,
    purpose ? `## This session's purpose\n\n${purpose}` : "",
    RETRIEVAL_POLICY,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildSetupMessage(modeId: string, assistantName: string) {
  return {
    model: LIVE_MODEL,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE } },
      },
    },
    systemInstruction: { parts: [{ text: buildSystemInstruction(modeId, assistantName) }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    tools: [{ googleSearch: {} }, { functionDeclarations: FUNCTION_DECLARATIONS }],
  };
}

export function timestampForFilename(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${day}-${time}`;
}

/**
 * Same file shape voice/server.js wrote, because the memory workflows read it.
 */
export function writeTranscript(turns: TalkTurn[], date = new Date()) {
  const body = turns
    .filter((turn) => typeof turn.text === "string" && turn.text.trim())
    .map((turn) => `**${turn.speaker}:** ${turn.text.trim()}`)
    .join("\n\n");

  if (!body) return null;

  fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  const filename = `${timestampForFilename(date)}.md`;
  const markdown = `# Voice session\n\nDate: ${date.toISOString()}\n\n${body}\n`;
  fs.writeFileSync(path.join(TRANSCRIPTS_DIR, filename), markdown, "utf8");
  return `voice/transcripts/${filename}`;
}
