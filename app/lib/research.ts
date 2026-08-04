import fs from "node:fs";
import path from "node:path";
import { geminiFetch } from "@/lib/gemini";
import { DEEP_RESEARCH_AGENT } from "@/lib/models";
import { dataPath, ensureDataDirectory } from "@/lib/paths";

/**
 * Deep Research through the Interactions API. A job runs in the background on
 * Google's side for up to ~20 minutes; we keep a small jobs file so the chat
 * brain (and the artist) can ask "is it done yet" across requests, and every
 * finished report lands as a cited markdown file in the external research/
 * folder, where the studio-file tools can read it back later.
 */

const RESEARCH_DIR = dataPath("research");
const JOBS_PATH = path.join(RESEARCH_DIR, "jobs.json");
const REPORT_PREVIEW_CHARS = 24 * 1024;

export type ResearchJob = {
  id: string;
  query: string;
  startedAt: string;
  status: "in_progress" | "completed" | "failed";
  reportPath?: string;
};

type Interaction = {
  id?: string;
  status?: string;
  steps?: { content?: { type?: string; text?: string }[] }[];
  error?: { message?: string };
};

function readJobs(): ResearchJob[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(JOBS_PATH, "utf8")) as { jobs?: ResearchJob[] };
    return Array.isArray(parsed.jobs) ? parsed.jobs : [];
  } catch {
    return [];
  }
}

function writeJobs(jobs: ResearchJob[]) {
  ensureDataDirectory("research");
  fs.writeFileSync(JOBS_PATH, `${JSON.stringify({ jobs }, null, 2)}\n`, "utf8");
}

export function listResearchJobs(): ResearchJob[] {
  return readJobs();
}

export function openResearchJobs(): ResearchJob[] {
  return readJobs().filter((job) => job.status === "in_progress");
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "research"
  );
}

function dayStamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export async function startDeepResearch(query: string): Promise<ResearchJob> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Deep research needs a research question.");

  const response = await geminiFetch("/interactions", {
    method: "POST",
    body: JSON.stringify({
      agent: DEEP_RESEARCH_AGENT,
      input: trimmed,
      background: true,
    }),
  });

  const interaction = (await response.json()) as Interaction;
  if (!interaction.id) throw new Error("Deep research did not return an interaction id.");

  const job: ResearchJob = {
    id: interaction.id,
    query: trimmed,
    startedAt: new Date().toISOString(),
    status: "in_progress",
  };
  writeJobs([...readJobs().filter((existing) => existing.id !== job.id), job]);
  return job;
}

function extractReport(interaction: Interaction) {
  const steps = interaction.steps ?? [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const text = (steps[index]?.content ?? [])
      .filter((item) => typeof item.text === "string")
      .map((item) => item.text)
      .join("\n\n")
      .trim();
    if (text) return text;
  }
  return "";
}

/**
 * Poll one job. On completion the report is written to research/ exactly once;
 * later checks return the saved file.
 */
export async function checkDeepResearch(id: string): Promise<ResearchJob & { report?: string }> {
  const jobs = readJobs();
  const job = jobs.find((entry) => entry.id === id);
  if (!job) throw new Error(`No research job with id ${id}. Known jobs: ${jobs.map((entry) => entry.id).join(", ") || "(none)"}.`);

  if (job.status === "completed" && job.reportPath) {
    const absolute = dataPath(job.reportPath);
    const report = fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : "";
    return { ...job, report: report.slice(0, REPORT_PREVIEW_CHARS) };
  }

  const response = await geminiFetch(`/interactions/${encodeURIComponent(id)}`, { method: "GET" });
  const interaction = (await response.json()) as Interaction;
  const status = interaction.status ?? "in_progress";

  if (status === "completed") {
    const report = extractReport(interaction);
    ensureDataDirectory("research");
    const filename = `${dayStamp(new Date(job.startedAt))}-${slugify(job.query)}.md`;
    const absolute = path.join(RESEARCH_DIR, filename);
    const header = `# Deep research: ${job.query}\n\nStarted: ${job.startedAt}\nInteraction: ${job.id}\n\n`;
    fs.writeFileSync(absolute, `${header}${report}\n`, "utf8");

    job.status = "completed";
    job.reportPath = `research/${filename}`;
    writeJobs(jobs);
    return { ...job, report: report.slice(0, REPORT_PREVIEW_CHARS) };
  }

  if (status === "failed") {
    job.status = "failed";
    writeJobs(jobs);
    const reason = interaction.error?.message ?? "no reason given";
    return { ...job, report: `The research run failed: ${reason}` };
  }

  return { ...job, status: "in_progress" };
}

export const DEEP_RESEARCH_DECLARATIONS = [
  {
    name: "start_deep_research",
    description:
      "Launch a background Deep Research agent that runs dozens of web searches and returns a cited report in up to twenty minutes. Costs real money per run, so use it only when the artist explicitly asks for deep or thorough research. Restate the research question in your reply when you start it.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "The full research question, with all the context the researcher needs.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "check_deep_research",
    description:
      "Check on a Deep Research job. Without an id it reports every job from this studio. When a job has finished, the report text comes back and the full report is saved in the research/ folder.",
    parameters: {
      type: "OBJECT",
      properties: {
        id: { type: "STRING", description: "The interaction id start_deep_research returned. Omit to list all jobs." },
      },
    },
  },
];

export function isResearchTool(name: string) {
  return name === "start_deep_research" || name === "check_deep_research";
}

export async function runResearchTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ result: unknown } | { error: string }> {
  try {
    if (name === "start_deep_research") {
      const job = await startDeepResearch(typeof args.query === "string" ? args.query : "");
      return {
        result: {
          ...job,
          note: "Research started in the background. It can take up to twenty minutes; check on it with check_deep_research.",
        },
      };
    }
    if (name === "check_deep_research") {
      const id = typeof args.id === "string" ? args.id.trim() : "";
      if (!id) {
        const jobs = listResearchJobs();
        return { result: { jobs, note: jobs.length ? undefined : "No research jobs have been started yet." } };
      }
      return { result: await checkDeepResearch(id) };
    }
    return { error: `Unknown research tool "${name}".` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The research tool failed." };
  }
}
