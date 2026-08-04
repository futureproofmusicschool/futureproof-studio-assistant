import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { readAssistantConfig } from "@/lib/config";
import {
  DATA_ROOT,
  MODEL_HISTORY_TURNS,
  appendTurn,
  appendTurns,
  readTurns,
  type ConversationTurn,
} from "@/lib/conversation-store";
import { requireGeminiKey, type GeminiContent, type GeminiPart } from "@/lib/gemini";
import { CHAT_MODEL } from "@/lib/models";
import { DEEP_RESEARCH_DECLARATIONS, isResearchTool, runResearchTool } from "@/lib/research";
import { buildSystemInstruction } from "@/lib/talk";
import { FUNCTION_DECLARATIONS, runStudioTool } from "@/lib/talk-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The text half of the conversation: Gemini Pro (thinking) over plain HTTP,
 * streamed back as SSE. History comes from the shared conversation store, not
 * from the browser, so a typed turn sees everything said in a voice call. Tool
 * calls run right here in the server process (no hop through /api/talk/tools,
 * which exists only because Live tool calls surface in the browser).
 */

const MAX_TOOL_ROUNDS = 8;

/**
 * Gemini Pro preview occasionally accepts a request and then never starts the
 * stream. Without a ceiling the window just sits there, so give up and say so.
 */
const MODEL_TIMEOUT_MS = 90_000;

/**
 * Thread turns to Gemini `contents`. Tool turns are display chips, not
 * conversation, so they never reach the model. Consecutive same-role turns are
 * merged because Gemini wants strict user/model alternation.
 *
 * Attachments: the binary rides along only on the newest turn, the one the
 * artist is asking about right now. Older turns replay as a marker plus
 * whatever text was extracted from the file, which keeps the PDF or the MIDI
 * analysis usable later without re-uploading megabytes on every message.
 */
function buildContents(turns: ConversationTurn[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  const newestIndex = turns.length - 1;

  turns.forEach((turn, index) => {
    if (turn.role === "tool") return;

    const role = turn.role === "assistant" ? "model" : "user";
    const parts: GeminiPart[] = [];
    const attachment = turn.attachment;

    if (attachment) {
      const isNewest = index === newestIndex;

      if (isNewest && (attachment.kind === "image" || attachment.kind === "pdf")) {
        try {
          const data = fs.readFileSync(path.join(DATA_ROOT, attachment.path)).toString("base64");
          parts.push({ inlineData: { mimeType: attachment.mimeType, data } });
        } catch {
          // A missing file must not break the turn; the summary still carries it.
        }
      }

      const label = `[Attached ${attachment.kind}: ${attachment.name}]`;
      // Images have no text to fall back on, so they are marker-only once past.
      const body = attachment.summary && attachment.kind !== "image" ? `\n\n${attachment.summary}` : "";
      parts.push({ text: `${label}${body}` });
    }

    const text = turn.text.trim();
    if (text) parts.push({ text });
    if (parts.length === 0) return;

    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push(...parts);
      return;
    }
    contents.push({ role, parts });
  });

  // Live and generateContent both reject history that opens on a model turn.
  if (contents.length > 0 && contents[0].role === "model") contents.shift();
  return contents;
}

type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: "running" | "done" | "error" }
  | { type: "done" }
  | { type: "error"; message: string };

function sseChunk(event: StreamEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

type StreamedCandidate = {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  error?: { message?: string };
};

/**
 * Read one streamGenerateContent?alt=sse response, forwarding text deltas via
 * emit and collecting the full model parts (text + functionCalls) for the
 * conversation history.
 */
async function consumeModelStream(
  response: Response,
  emit: (event: StreamEvent) => void,
): Promise<GeminiPart[]> {
  const collected: GeminiPart[] = [];
  let textBuffer = "";
  let textSignature: string | undefined;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Gemini returned no response body.");

  const decoder = new TextDecoder();
  let pending = "";

  const flushText = () => {
    if (textBuffer) {
      collected.push({ text: textBuffer, ...(textSignature ? { thoughtSignature: textSignature } : {}) });
      textBuffer = "";
      textSignature = undefined;
    }
  };

  const handleLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;

    let parsed: StreamedCandidate;
    try {
      parsed = JSON.parse(payload) as StreamedCandidate;
    } catch {
      return;
    }
    if (parsed.error?.message) throw new Error(parsed.error.message);

    for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
      if (part.thought) {
        // Thought summaries are not shown, but their signatures must survive
        // the round trip or the follow-up request is rejected.
        if (part.thoughtSignature) {
          collected.push({ thought: true, text: part.text ?? "", thoughtSignature: part.thoughtSignature });
        }
        continue;
      }
      if (typeof part.text === "string" && part.text) {
        textBuffer += part.text;
        if (part.thoughtSignature) textSignature = part.thoughtSignature;
        emit({ type: "text", delta: part.text });
      }
      if (part.functionCall) {
        flushText();
        collected.push({
          functionCall: part.functionCall,
          ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
        });
      }
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });

    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      handleLine(pending.slice(0, newline).trim());
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
  }
  handleLine(pending.trim());
  flushText();
  return collected;
}

async function runTool(name: string, args: Record<string, unknown>) {
  if (isResearchTool(name)) return runResearchTool(name, args);
  return runStudioTool(name, args);
}

export async function POST(request: Request) {
  let body: { text?: unknown; answerOnly?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  // answerOnly: the user's turn is already in the thread (an upload wrote it),
  // so this request is only asking for the reply.
  const answerOnly = body.answerOnly === true;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text && !answerOnly) {
    return NextResponse.json({ error: "text is required." }, { status: 400 });
  }

  let key: string;
  try {
    key = requireGeminiKey();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No Gemini API key." },
      { status: 400 },
    );
  }

  const config = readAssistantConfig();
  const systemInstruction = await buildSystemInstruction("open", config.name, "text");

  // History lives on the server, so a text turn sees everything said in a voice
  // call and vice versa. The user turn is persisted before the model runs: a
  // crash mid-answer must not lose what the artist said.
  const history = readTurns({ limit: MODEL_HISTORY_TURNS });
  const userTurn = answerOnly ? null : appendTurn({ role: "user", mode: "text", text });
  const contents: GeminiContent[] = buildContents([...history, ...(userTurn ? [userTurn] : [])]);

  const assistantSegments: string[] = [];
  const toolTurns: { role: "tool"; mode: "text"; text: string }[] = [];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (event: StreamEvent) => controller.enqueue(encoder.encode(sseChunk(event)));

      try {
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
          const abort = new AbortController();
          const deadline = setTimeout(() => abort.abort(), MODEL_TIMEOUT_MS);
          let response: Response;
          try {
            response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:streamGenerateContent?alt=sse`,
            {
              method: "POST",
              signal: abort.signal,
              headers: { "Content-Type": "application/json", "x-goog-api-key": key },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemInstruction }] },
                contents,
                tools: [
                  {
                    functionDeclarations: [...FUNCTION_DECLARATIONS, ...DEEP_RESEARCH_DECLARATIONS],
                  },
                  { googleSearch: {} },
                ],
                // Gemini requires this opt-in to mix built-in search with
                // function calling on generateContent (the Live API does not).
                toolConfig: { includeServerSideToolInvocations: true },
              }),
            },
            );
          } catch (caught) {
            if (abort.signal.aborted) {
              throw new Error(
                "Gemini took too long to answer and the request was dropped. Everything you said is saved; try again.",
              );
            }
            throw caught;
          } finally {
            clearTimeout(deadline);
          }

          if (!response.ok) {
            throw new Error(`Gemini refused the chat request (${response.status}): ${(await response.text()).slice(0, 400)}`);
          }

          const modelParts = await consumeModelStream(response, emit);
          for (const part of modelParts) {
            if (!part.thought && part.text) assistantSegments.push(part.text);
          }

          const calls = modelParts.filter(
            (part): part is GeminiPart & { functionCall: NonNullable<GeminiPart["functionCall"]> } =>
              Boolean(part.functionCall),
          );

          if (calls.length === 0 || round === MAX_TOOL_ROUNDS) {
            emit({ type: "done" });
            break;
          }

          contents.push({ role: "model", parts: modelParts });

          const responses: GeminiPart[] = [];
          for (const call of calls) {
            emit({ type: "tool", name: call.functionCall.name, status: "running" });
            const outcome = await runTool(call.functionCall.name, call.functionCall.args ?? {});
            const failed = "error" in outcome;
            emit({ type: "tool", name: call.functionCall.name, status: failed ? "error" : "done" });
            toolTurns.push({
              role: "tool",
              mode: "text",
              text: `${call.functionCall.name} ${failed ? "failed" : "done"}`,
            });
            responses.push({
              functionResponse: {
                name: call.functionCall.name,
                response: outcome as Record<string, unknown>,
              },
            });
          }
          contents.push({ role: "user", parts: responses });
        }
      } catch (error) {
        emit({
          type: "error",
          message: error instanceof Error ? error.message : "The chat request failed.",
        });
      } finally {
        // Persist whatever was produced, even on a mid-stream failure: a partial
        // answer the artist already read belongs in the thread.
        const answer = assistantSegments.join("").trim();
        appendTurns([...toolTurns, ...(answer ? [{ role: "assistant" as const, mode: "text" as const, text: answer }] : [])]);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
