"use client";

import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type ChatViewProps = {
  assistantName: string;
};

type StreamEvent = {
  event: string;
  data: unknown;
};

const STORAGE_KEY = "teo-chat-conversation";
const HANDOFF_KEY = "studio-assistant-chat-handoff-draft";

function inlineContent(text: string, keyPrefix: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);

  return tokens.filter(Boolean).map((token, index) => {
    const key = `${keyPrefix}-${index}`;

    if (token.startsWith("**") && token.endsWith("**")) {
      return <strong key={key}>{token.slice(2, -2)}</strong>;
    }

    if (token.startsWith("`") && token.endsWith("`")) {
      return <code key={key}>{token.slice(1, -1)}</code>;
    }

    return <Fragment key={key}>{token}</Fragment>;
  });
}

function formattedText(text: string) {
  const blocks: ReactNode[] = [];
  let cursor = 0;
  let blockIndex = 0;

  while (cursor < text.length) {
    const fenceStart = text.indexOf("```", cursor);

    if (fenceStart === -1) {
      blocks.push(
        <span className="chat-prose" key={`text-${blockIndex}`}>
          {inlineContent(text.slice(cursor), `inline-${blockIndex}`)}
        </span>,
      );
      break;
    }

    if (fenceStart > cursor) {
      blocks.push(
        <span className="chat-prose" key={`text-${blockIndex}`}>
          {inlineContent(text.slice(cursor, fenceStart), `inline-${blockIndex}`)}
        </span>,
      );
      blockIndex += 1;
    }

    const contentStart = fenceStart + 3;
    const firstLineEnd = text.indexOf("\n", contentStart);
    const fenceEnd = text.indexOf("```", firstLineEnd === -1 ? contentStart : firstLineEnd + 1);
    const hasLanguage = firstLineEnd !== -1 && (fenceEnd === -1 || firstLineEnd < fenceEnd);
    const codeStart = hasLanguage ? firstLineEnd + 1 : contentStart;
    const codeEnd = fenceEnd === -1 ? text.length : fenceEnd;
    const language = hasLanguage ? text.slice(contentStart, firstLineEnd).trim() : "";

    blocks.push(
      <pre className="chat-code-block" key={`code-${blockIndex}`}>
        {language ? <span className="chat-code-language">{language}</span> : null}
        <code>{text.slice(codeStart, codeEnd).replace(/\n$/, "")}</code>
      </pre>,
    );

    blockIndex += 1;
    cursor = fenceEnd === -1 ? text.length : fenceEnd + 3;
  }

  return blocks;
}

function parseEvent(rawEvent: string): StreamEvent | null {
  let event = "message";
  const data: string[] = [];

  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }

  if (data.length === 0) {
    return null;
  }

  try {
    return { event, data: JSON.parse(data.join("\n")) as unknown };
  } catch {
    return null;
  }
}

function eventRecord(data: unknown): Record<string, unknown> {
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
}

export function ChatView({ assistantName }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string>();
  const [hydrated, setHydrated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { messages?: ChatMessage[]; sessionId?: string };
        if (Array.isArray(parsed.messages)) {
          setMessages(parsed.messages);
        }
        if (typeof parsed.sessionId === "string") {
          setSessionId(parsed.sessionId);
        }
      }
      const handoff = window.sessionStorage.getItem(HANDOFF_KEY);
      if (handoff) {
        setDraft(handoff);
        window.sessionStorage.removeItem(HANDOFF_KEY);
      }
    } catch {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages, sessionId }));
  }, [hydrated, messages, sessionId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [messages, streaming]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  };

  const newConversation = () => {
    stop();
    setMessages([]);
    setSessionId(undefined);
    setDraft("");
    setError(undefined);
    window.sessionStorage.removeItem(STORAGE_KEY);
  };

  const send = async () => {
    const message = draft.trim();
    if (!message || streaming) {
      return;
    }

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", text: message };
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: "",
    };
    const controller = new AbortController();

    abortRef.current = controller;
    setDraft("");
    setError(undefined);
    setStreaming(true);
    setMessages((current) => [...current, userMessage, assistantMessage]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Chat request failed with status ${response.status}.`);
      }

      if (!response.body) {
        throw new Error("The chat response did not include a stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (rawEvent: string) => {
        const parsed = parseEvent(rawEvent);
        if (!parsed) {
          return;
        }

        const data = eventRecord(parsed.data);

        if (parsed.event === "session" && typeof data.sessionId === "string") {
          setSessionId(data.sessionId);
        } else if (parsed.event === "text" && typeof data.text === "string") {
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantMessage.id ? { ...item, text: item.text + data.text } : item,
            ),
          );
        } else if (parsed.event === "error") {
          throw new Error(
            typeof data.message === "string" ? data.message : "The agent stopped unexpectedly.",
          );
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");

        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          handleEvent(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }

        if (done) {
          if (buffer.trim()) {
            handleEvent(buffer);
          }
          break;
        }
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "The agent stopped unexpectedly.");
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setStreaming(false);
      }
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <section className="chat-page">
      <header className="chat-heading">
        <div>
          <p className="eyebrow">Repository agent</p>
          <h1>Chat</h1>
        </div>
        <button className="chat-new-button" onClick={newConversation} type="button">
          New conversation
        </button>
      </header>

      <div className="chat-transcript" aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <span className="chat-empty-mark" aria-hidden="true" />
            <p>
              This is {assistantName} with full memory: the repo, the board, and everything you have
              taught it.
            </p>
          </div>
        ) : (
          <div className="chat-messages">
            {messages.map((message) => (
              <article className={`chat-message chat-message-${message.role}`} key={message.id}>
                <p className="chat-message-label">
                  {message.role === "assistant" ? assistantName : "You"}
                </p>
                <div className="chat-message-body">
                  {message.text ? formattedText(message.text) : <span className="chat-cursor" />}
                </div>
              </article>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="chat-composer-shell">
        {error ? (
          <div className="chat-error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError(undefined)} type="button">
              Dismiss
            </button>
          </div>
        ) : null}
        <div className="chat-composer">
          <textarea
            aria-label={`Message ${assistantName}`}
            disabled={streaming}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask ${assistantName} about this repo...`}
            rows={3}
            value={draft}
          />
          {streaming ? (
            <button className="chat-stop-button" onClick={stop} type="button">
              <span aria-hidden="true" />
              Stop
            </button>
          ) : (
            <button className="chat-send-button" disabled={!draft.trim()} onClick={send} type="button">
              Send
            </button>
          )}
        </div>
        <p className="chat-repo-note">{assistantName} can read and edit this repo, including the board.</p>
      </div>
    </section>
  );
}
