import fs from "node:fs";
import path from "node:path";
import { repoPath } from "@/lib/paths";

const TEMPLATES_DIR = repoPath("interviews", "templates");
export const TRANSCRIPTS_DIR = repoPath("voice", "transcripts");
const VOICE_PROMPT_PATH = repoPath("voice", "prompt.md");
const TEMPLATE_HEADER = /^<!--\s*title:\s*(.*?)\s*\|\s*desc:\s*(.*?)\s*-->\s*\n?/;
const TEMPLATE_ID = /^[a-z0-9-]+$/;

export type InterviewTemplate = {
  id: string;
  title: string;
  description: string;
  needsTopic: boolean;
};

export type TranscriptSummary = {
  file: string;
  date: string;
  size: number;
  preview: string;
};

function readTemplateSource(id: string) {
  if (!TEMPLATE_ID.test(id)) {
    throw new Error("Unknown interview template.");
  }

  const templatePath = path.join(TEMPLATES_DIR, `${id}.md`);
  if (!fs.existsSync(templatePath)) {
    throw new Error("Unknown interview template.");
  }

  return fs.readFileSync(templatePath, "utf8");
}

export function listInterviewTemplates(): InterviewTemplate[] {
  return fs
    .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const id = entry.name.slice(0, -3);
      const source = readTemplateSource(id);
      const match = source.match(TEMPLATE_HEADER);

      if (!match) {
        throw new Error(`Interview template ${entry.name} is missing its metadata comment.`);
      }

      return {
        id,
        title: match[1],
        description: match[2],
        needsTopic: source.includes("{topic}"),
      };
    });
}

export function resolveInterviewTemplate(id: string, name: string, topic?: string) {
  const source = readTemplateSource(id).replace(TEMPLATE_HEADER, "").trim();
  const cleanName = name.trim();
  const cleanTopic = topic?.trim() ?? "";

  if (!cleanName) {
    throw new Error("The assistant name is missing.");
  }
  if (source.includes("{topic}") && !cleanTopic) {
    throw new Error("Add a topic for this interview.");
  }

  return `${source
    .replaceAll("{name}", () => cleanName)
    .replaceAll("{topic}", () => cleanTopic)}\n`;
}

export function writeVoicePrompt(contents: string) {
  const temporaryPath = `${VOICE_PROMPT_PATH}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(temporaryPath, contents, "utf8");
    fs.renameSync(temporaryPath, VOICE_PROMPT_PATH);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }
}

export function prepareInterview(id: string, name: string, topic?: string) {
  const prompt = resolveInterviewTemplate(id, name, topic);
  writeVoicePrompt(prompt);
  return prompt;
}

function firstUserLine(contents: string, assistantName: string) {
  for (const line of contents.split("\n")) {
    const match = line.match(/^\*\*([^*]+):\*\*\s*(.+)$/);
    if (match && match[1].trim().toLowerCase() !== assistantName.trim().toLowerCase()) {
      return match[2].trim();
    }
  }
  return "No user preview available.";
}

export function listTranscripts(assistantName: string): TranscriptSummary[] {
  if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    return [];
  }

  return fs
    .readdirSync(TRANSCRIPTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const transcriptPath = path.join(TRANSCRIPTS_DIR, entry.name);
      const stats = fs.statSync(transcriptPath);
      const contents = fs.readFileSync(transcriptPath, "utf8");
      const sessionDate = contents.match(/^Date:\s*(.+)$/m)?.[1];
      const parsedDate = sessionDate ? new Date(sessionDate) : undefined;
      return {
        file: entry.name,
        date:
          parsedDate && !Number.isNaN(parsedDate.getTime())
            ? parsedDate.toISOString()
            : stats.mtime.toISOString(),
        size: stats.size,
        preview: firstUserLine(contents, assistantName),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function resolveTranscriptPath(file: string) {
  if (!file || path.extname(file).toLowerCase() !== ".md") {
    throw new Error("Only markdown transcripts can be opened.");
  }

  const resolvedDirectory = fs.realpathSync(TRANSCRIPTS_DIR);
  const candidateFile = path.resolve(resolvedDirectory, file);
  if (!candidateFile.startsWith(`${resolvedDirectory}${path.sep}`)) {
    throw new Error("Transcript path is outside the transcripts directory.");
  }

  const resolvedFile = fs.realpathSync(candidateFile);
  if (!resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`)) {
    throw new Error("Transcript path is outside the transcripts directory.");
  }

  return resolvedFile;
}

export async function checkVoiceServer(timeoutMs = 900) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("http://localhost:3015/", {
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
