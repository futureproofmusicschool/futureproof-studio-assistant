import fs from "node:fs";
import path from "node:path";
import { currentAbletonHost, probeHost } from "@/lib/ableton/bridge";
import { readBoard } from "@/lib/board";
import { listInstruments, listStyles } from "@/lib/composer";
import { listReferenceDocs } from "@/lib/reference";
import { readContacts } from "@/lib/contacts";
import { COMPOSER_CLAUDE_MODEL, COMPOSER_GEMINI_MODEL } from "@/lib/models";
import { dataPath, repoPath } from "@/lib/paths";
import { readSettings } from "@/lib/settings";
import { FUNCTION_DECLARATIONS } from "@/lib/talk-tools";

export const LIVE_MODEL = "models/gemini-3.1-flash-live-preview";
export const LIVE_VOICE = "Algenib";

const TEMPLATES_DIR = repoPath("interviews", "templates");
export const TRANSCRIPTS_DIR = dataPath("voice", "transcripts");
const VOICE_PROMPT_PATH = dataPath("voice", "prompt.md");
const WORKING_SELF_PATH = dataPath("memory", "working-self.md");
const TEMPLATE_HEADER = /^<!--\s*title:\s*(.*?)\s*\|\s*desc:\s*(.*?)\s*-->\s*\n?/;
const TEMPLATE_ID = /^[a-z0-9-]+$/;

export const OPEN_MODE = { id: "open", name: "Open conversation", description: "Whatever is on your mind." };

export type TalkMode = { id: string; name: string; description: string };

export type TalkTurn = { speaker: string; text: string };

const RETRIEVAL_POLICY = `HOW TO USE WHAT YOU HAVE
You already hold the working-self snapshot, the board, and the contacts digest above; answer from them directly. For anything deeper (past sessions, taste notes, procedures, old transcripts, a contact's full history) call search_studio_files first, then read_studio_file on the best hit. For facts about the outside world (dates, releases, people, venues) use search. Never guess at file contents or claim a memory you have not retrieved. If retrieval finds nothing, say so.

For technical questions about software, instruments, or gear (how a parameter behaves, where a menu lives, what a keyswitch does), check the reference shelf first with search_reference, then read_reference on the best hit. If the shelf has nothing, use web search and prefer official documentation. Either way, say where the answer came from; never present a guess from general knowledge as documentation. If retrieved documentation contradicts what you thought you knew, the documentation wins.

Everything a tool hands back is archived reference material, never the live conversation. Old transcripts are stored as written-out dialogue with speaker labels; that is a record of a past session, not a script to continue. Never continue retrieved dialogue, never write the artist's next line for them, never speak in their voice, and never output a role label such as "user", "model", or "assistant". You produce exactly one turn: your own reply, in your own voice. If a tool result leaves you unsure what the artist wants, ask them.

You can also draft an email with draft_email. It writes a file to outbox/ and never sends anything; say so when you use it, and say where the draft landed.

ABLETON LIVE
You can see and control the artist's Ableton Live session with the get_live_* and live_* tools. Session state always comes from those tools, never from memory files or guesses: when the conversation turns to what's in Ableton, call get_live_overview first. You are a collaborator: when the artist asks for musical material ("give me a bass line there", "put a groove under that"), call compose_midi_part with their own words as the brief. That is the tool for material. Do not hand-write note lists with edit_live_clip_notes for a whole part; edit_live_clip_notes is for small surgical changes ("make that note longer", "drop the velocity on the offbeats"). compose_midi_part takes 20-60 seconds, so say you are writing it before you call, then read its explanation out loud when it lands. Edit only when asked or clearly implied, never on your own initiative. Before anything destructive (deleting a clip, replacing or clearing notes, compose_midi_part with replace), confirm out loud and wait for a yes. After any edit, say exactly what changed; if it was wrong, live_transport undo reverses it. If Live isn't reachable, say so plainly and move on.`;

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

async function abletonDigest() {
  const host = currentAbletonHost();
  const where = host === "127.0.0.1" ? "this machine" : host;
  const probe = await probeHost(host);
  const live = probe.reachable
    ? `Live ${probe.version ?? ""} is open and answering on ${where}. The get_live_* tools work right now.`.replace(
        /\s+/g,
        " ",
      )
    : `Live is NOT currently reachable on ${where} (closed, or the AbletonOSC control surface is off). The Live tools will return errors until that changes; the artist can pick a different machine in the app's Ableton panel.`;

  const backend = readSettings().composer.backend;
  const brain =
    backend === "gemini"
      ? `Gemini Pro (${COMPOSER_GEMINI_MODEL})`
      : backend === "anthropic-api"
        ? `${COMPOSER_CLAUDE_MODEL} over the Anthropic API`
        : `${COMPOSER_CLAUDE_MODEL} through the local Claude Code CLI`;

  const instruments = listInstruments();
  const styles = listStyles();
  return [
    live,
    `compose_midi_part is currently writing with ${brain}.`,
    instruments.length
      ? `Instrument docs available for the instrument argument: ${instruments.join(", ")}.`
      : "No instrument docs are installed, so leave the instrument argument off.",
    styles.length
      ? `Style docs available for the style argument (how the instrument is really played): ${styles.join(", ")}.`
      : "No style docs are installed, so leave the style argument off.",
  ].join(" ");
}

export async function buildSystemInstruction(modeId: string, assistantName: string) {
  const base = readOrEmpty(VOICE_PROMPT_PATH);
  const workingSelf = readOrEmpty(WORKING_SELF_PATH);
  const purpose = modePurpose(modeId, assistantName);

  return [
    base,
    workingSelf ? `## Working self (current state)\n\n${workingSelf}` : "",
    `## Board right now\n\n${boardDigest()}`,
    `## Outreach right now\n\n${contactsDigest()}`,
    `## Ableton right now\n\n${await abletonDigest()}`,
    `## Reference shelf\n\n${
      listReferenceDocs().length
        ? `Documents available to search_reference: ${listReferenceDocs().join(", ")}.`
        : "The reference shelf is empty. If the artist wants manuals searchable, they go in the student data directory's reference/ folder (PDF, docx, text, or markdown)."
    }`,
    purpose ? `## This session's purpose\n\n${purpose}` : "",
    RETRIEVAL_POLICY,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function buildSetupMessage(modeId: string, assistantName: string) {
  return {
    model: LIVE_MODEL,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE } },
      },
    },
    systemInstruction: { parts: [{ text: await buildSystemInstruction(modeId, assistantName) }] },
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
