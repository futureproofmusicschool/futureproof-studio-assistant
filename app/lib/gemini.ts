import { readGeminiApiKey } from "@/lib/env";

/**
 * The one place the server talks to the Gemini REST API. bookkeeping.ts and
 * composer.ts predate this helper and carry their own copies; new call sites
 * (chat, deep research) go through here.
 */

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export function requireGeminiKey() {
  const key = readGeminiApiKey();
  if (!key) throw new Error("No Gemini API key is saved. Add one in Settings.");
  return key;
}

export async function geminiFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": requireGeminiKey(),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Gemini request failed (${response.status}): ${detail}`);
  }

  return response;
}

export type GeminiPart = {
  text?: string;
  thought?: boolean;
  /** Gemini 3 attaches signatures to model parts; requests that echo history must send them back. */
  thoughtSignature?: string;
  /** Base64 file bytes: images and PDFs the artist attached to a turn. */
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
};

export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

/** Collapse a candidate's parts into plain text, skipping thought summaries. */
export function candidateText(parts: GeminiPart[] | undefined) {
  return (parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}
