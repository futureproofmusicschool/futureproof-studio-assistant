import { query } from "@anthropic-ai/claude-agent-sdk";
import { Codex, type ThreadEvent } from "@openai/codex-sdk";
import { isChatProvider, readAssistantConfig, type ChatProvider } from "@/lib/config";
import { REPO_ROOT } from "@/lib/paths";

export const runtime = "nodejs";
export const maxDuration = 300;

type ChatRequest = {
  message?: unknown;
  provider?: unknown;
  sessionId?: unknown;
};

type StreamControls = {
  abortController: AbortController;
  enqueue: (event: string, data: unknown) => void;
  message: string;
  sessionId: string;
  setCancelAgent: (cancel: () => void) => void;
};

const encoder = new TextEncoder();

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The agent stopped unexpectedly.";
}

async function streamClaude({
  abortController,
  enqueue,
  message,
  sessionId,
  setCancelAgent,
}: StreamControls) {
  const agentQuery = query({
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

  setCancelAgent(() => agentQuery.close());
  let receivedTextDelta = false;

  for await (const sdkMessage of agentQuery) {
    if (abortController.signal.aborted) {
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

    if (sdkMessage.type === "result" && (sdkMessage.subtype !== "success" || sdkMessage.is_error)) {
      throw new Error(
        sdkMessage.subtype === "success"
          ? sdkMessage.result || "The agent could not complete this turn."
          : sdkMessage.errors.join("\n") || "The agent could not complete this turn.",
      );
    }
  }
}

function codexTextDelta(event: ThreadEvent, emittedText: Map<string, string>) {
  if (
    (event.type !== "item.started" &&
      event.type !== "item.updated" &&
      event.type !== "item.completed") ||
    event.item.type !== "agent_message"
  ) {
    return "";
  }

  const previous = emittedText.get(event.item.id) ?? "";
  const current = event.item.text;
  emittedText.set(event.item.id, current);

  return current.startsWith(previous) ? current.slice(previous.length) : "";
}

async function streamCodex({
  abortController,
  enqueue,
  message,
  sessionId,
}: StreamControls) {
  const codex = new Codex();
  const threadOptions = {
    approvalPolicy: "never" as const,
    sandboxMode: "workspace-write" as const,
    workingDirectory: REPO_ROOT,
  };
  const thread = sessionId
    ? codex.resumeThread(sessionId, threadOptions)
    : codex.startThread(threadOptions);

  if (sessionId) {
    enqueue("session", { sessionId });
  }

  const { events } = await thread.runStreamed(message, { signal: abortController.signal });
  const emittedText = new Map<string, string>();

  for await (const event of events) {
    if (abortController.signal.aborted) {
      break;
    }

    if (event.type === "thread.started") {
      enqueue("session", { sessionId: event.thread_id });
      continue;
    }

    if (event.type === "turn.failed") {
      throw new Error(event.error.message);
    }

    if (event.type === "error") {
      throw new Error(event.message);
    }

    const text = codexTextDelta(event, emittedText);
    if (text) {
      enqueue("text", { text });
    }
  }
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
  const configuredProvider = readAssistantConfig().chatProvider;
  const requestedProvider = body.provider ?? configuredProvider;

  if (!message) {
    return Response.json({ error: "Message is required." }, { status: 400 });
  }

  if (!isChatProvider(requestedProvider)) {
    return Response.json({ error: "Provider must be either claude or codex." }, { status: 400 });
  }

  const provider: ChatProvider = requestedProvider;

  const abortController = new AbortController();
  let cancelAgent = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

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
        cancelAgent();
        close();
      };

      request.signal.addEventListener("abort", handleAbort, { once: true });

      const controls: StreamControls = {
        abortController,
        enqueue,
        message,
        sessionId,
        setCancelAgent: (cancel) => {
          cancelAgent = cancel;
        },
      };

      try {
        if (provider === "codex") {
          await streamCodex(controls);
        } else {
          await streamClaude(controls);
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
        cancelAgent();
        close();
      }
    },
    cancel() {
      abortController.abort();
      cancelAgent();
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
