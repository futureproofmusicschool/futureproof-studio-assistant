import type { GeminiPart } from "./gemini";
import { readWithDeadline } from "./request-deadline";

type StreamEvent = { type: "text"; delta: string };
type StreamedCandidate = {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  error?: { message?: string };
};

/**
 * Read one streamGenerateContent?alt=sse response, forwarding text deltas via
 * emit and collecting the full model parts (text + functionCalls) for the
 * conversation history.
 */
export async function consumeModelStream(
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

  try {
  for (;;) {
    const { value, done } = await readWithDeadline(() => reader.read(), 90_000, () => { void reader.cancel().catch(() => {}); });
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
  } finally { reader.releaseLock(); }
}

