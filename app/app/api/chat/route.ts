import { query } from "@anthropic-ai/claude-agent-sdk";
import { REPO_ROOT } from "@/lib/paths";

export const runtime = "nodejs";
export const maxDuration = 300;

type ChatRequest = {
  message?: unknown;
  sessionId?: unknown;
};

const encoder = new TextEncoder();

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The agent stopped unexpectedly.";
}

export async function POST(request: Request) {
  let body: ChatRequest;

  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";

  if (!message) {
    return Response.json({ error: "Message is required." }, { status: 400 });
  }

  const abortController = new AbortController();
  let agentQuery: ReturnType<typeof query> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let receivedTextDelta = false;

      const enqueue = (event: string, data: unknown) => {
        if (!closed && !request.signal.aborted) {
          controller.enqueue(sse(event, data));
        }
      };

      const close = () => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            return;
          }
        }
      };

      const handleAbort = () => {
        abortController.abort();
        agentQuery?.close();
        close();
      };

      request.signal.addEventListener("abort", handleAbort, { once: true });

      try {
        agentQuery = query({
          prompt: message,
          options: {
            abortController,
            allowDangerouslySkipPermissions: true,
            cwd: REPO_ROOT,
            includePartialMessages: true,
            permissionMode: "bypassPermissions",
            settingSources: ["user", "project", "local"],
            systemPrompt: { type: "preset", preset: "claude_code" },
            ...(sessionId ? { resume: sessionId } : {}),
          },
        });

        for await (const sdkMessage of agentQuery) {
          if (request.signal.aborted) {
            break;
          }

          if (sdkMessage.type === "system" && sdkMessage.subtype === "init") {
            enqueue("session", { sessionId: sdkMessage.session_id });
            continue;
          }

          if (
            sdkMessage.type === "stream_event" &&
            sdkMessage.event.type === "content_block_delta" &&
            sdkMessage.event.delta.type === "text_delta"
          ) {
            receivedTextDelta = true;
            enqueue("text", { text: sdkMessage.event.delta.text });
            continue;
          }

          if (sdkMessage.type === "assistant" && !receivedTextDelta) {
            for (const block of sdkMessage.message.content) {
              if (block.type === "text") {
                enqueue("text", { text: block.text });
              }
            }
            continue;
          }

          if (
            sdkMessage.type === "result" &&
            (sdkMessage.subtype !== "success" || sdkMessage.is_error)
          ) {
            enqueue("error", {
              message:
                sdkMessage.subtype === "success"
                  ? sdkMessage.result || "The agent could not complete this turn."
                  : sdkMessage.errors.join("\n") || "The agent could not complete this turn.",
            });
            close();
            return;
          }
        }

        if (!request.signal.aborted) {
          enqueue("done", { ok: true });
        }
      } catch (error) {
        if (!request.signal.aborted) {
          enqueue("error", { message: errorMessage(error) });
        }
      } finally {
        request.signal.removeEventListener("abort", handleAbort);
        agentQuery?.close();
        close();
      }
    },
    cancel() {
      abortController.abort();
      agentQuery?.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
