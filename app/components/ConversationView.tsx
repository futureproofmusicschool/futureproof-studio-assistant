"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AbletonChip } from "@/components/AbletonPanel";
import { SetupPanel } from "@/components/SetupPanel";
import { WorkingDots } from "@/components/Working";
import { TOOL_SPEAKER, useGeminiLive } from "@/hooks/useGeminiLive";
import type { TalkMode } from "@/lib/talk";

/**
 * One conversation, typed or spoken.
 *
 * There is no session to start and no session to end: the thread lives on the
 * server and this window is a view onto it. Typing goes to Gemini Pro over SSE;
 * pressing Call opens a Gemini Live socket whose turns land in the same thread,
 * so the two halves can see each other's context.
 */

type ConversationViewProps = {
  assistantName: string;
  userName: string;
  modes: TalkMode[];
};

type NewStreamItem =
  | { kind: "turn"; role: "user" | "model"; text: string; attachment?: AttachmentInfo }
  | { kind: "tool"; name: string; status: "running" | "done" | "error" }
  | { kind: "notice"; text: string };

type StreamItem = NewStreamItem & { id: number };

type AttachmentInfo = { kind: string; name: string };

type ResearchJob = {
  id: string;
  query: string;
  status: "in_progress" | "completed" | "failed";
  reportPath?: string;
};

type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: "running" | "done" | "error" }
  | { type: "done" }
  | { type: "error"; message: string };

type ThreadTurn = {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  attachment?: AttachmentInfo;
};

const RESEARCH_POLL_MS = 60_000;

const CALL_STATUS_LABEL: Record<string, string> = {
  connecting: "Connecting",
  live: "Listening",
  reconnecting: "Reconnecting",
};

export function ConversationView({ assistantName, userName, modes }: ConversationViewProps) {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [research, setResearch] = useState<ResearchJob[]>([]);
  const [modePickerOpen, setModePickerOpen] = useState(false);
  const [modeId, setModeId] = useState(modes[0]?.id ?? "open");
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const nextIdRef = useRef(1);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const append = useCallback((item: NewStreamItem) => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    setItems((current) => [...current, { ...item, id }]);
    return id;
  }, []);

  const toStreamItems = useCallback((turns: ThreadTurn[]) => {
    return turns.map((turn) => {
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      return turn.role === "tool"
        ? ({ id, kind: "tool", name: turn.text, status: "done" } as StreamItem)
        : ({
            id,
            kind: "turn",
            role: turn.role === "assistant" ? "model" : "user",
            text: turn.text,
            ...(turn.attachment ? { attachment: turn.attachment } : {}),
          } as StreamItem);
    });
  }, []);

  const loadThread = useCallback(async () => {
    try {
      const body = (await (await fetch("/api/conversation", { cache: "no-store" })).json()) as {
        turns?: ThreadTurn[];
      };
      setItems(toStreamItems(body.turns ?? []));
    } catch {
      // An unreadable thread is an empty conversation, not an error worth a banner.
    }
  }, [toStreamItems]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  // ------------------------------------------------------------------
  // The call
  // ------------------------------------------------------------------

  const {
    status,
    error: callError,
    turns: callTurns,
    toolActivity,
    micLevel,
    muted,
    setMuted,
    idleSecondsLeft,
    stayAlive,
    connect,
    disconnect,
    sendText: sendToCall,
    clearError: clearCallError,
  } = useGeminiLive({
    userLabel: userName,
    assistantLabel: assistantName,
    onAutoEnd: () => void loadThread(),
  });

  const inCall = status === "connecting" || status === "live" || status === "reconnecting";
  const runningTools = new Set(
    toolActivity.filter((entry) => entry.status === "running").map((entry) => `${entry.name} running`),
  );

  const startCall = useCallback(
    async (id: string) => {
      setModePickerOpen(false);
      setModeId(id);
      pinnedRef.current = true;
      await connect(id);
    },
    [connect],
  );

  const endCall = useCallback(async () => {
    await disconnect();
    // The relay wrote the call's turns as they happened; reloading swaps this
    // window's live fragments for the merged versions on disk.
    await loadThread();
  }, [disconnect, loadThread]);

  useEffect(() => {
    const element = streamRef.current;
    if (element && pinnedRef.current) element.scrollTop = element.scrollHeight;
  }, [items, callTurns]);

  // ------------------------------------------------------------------
  // Deep research keeps running after the turn that started it ends.
  // ------------------------------------------------------------------

  const refreshResearch = useCallback(async () => {
    try {
      const listed = (await (await fetch("/api/chat/research")).json()) as { jobs?: ResearchJob[] };
      const jobs = listed.jobs ?? [];

      for (const job of jobs.filter((entry) => entry.status === "in_progress")) {
        const polled = (await (await fetch(`/api/chat/research?id=${encodeURIComponent(job.id)}`)).json()) as {
          job?: ResearchJob;
        };
        if (polled.job && polled.job.status !== "in_progress") {
          append({
            kind: "notice",
            text:
              polled.job.status === "completed"
                ? `Deep research finished: "${polled.job.query}". Report saved to ${polled.job.reportPath}.`
                : `Deep research failed: "${polled.job.query}".`,
          });
        }
      }

      const refreshed = (await (await fetch("/api/chat/research")).json()) as { jobs?: ResearchJob[] };
      setResearch(refreshed.jobs ?? jobs);
    } catch {
      // Polling never raises its own banner.
    }
  }, [append]);

  useEffect(() => {
    void refreshResearch();
  }, [refreshResearch]);

  const openJobs = research.filter((job) => job.status === "in_progress");

  useEffect(() => {
    if (openJobs.length === 0) return;
    const timer = window.setInterval(() => void refreshResearch(), RESEARCH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [openJobs.length, refreshResearch]);

  // ------------------------------------------------------------------
  // Sending
  // ------------------------------------------------------------------

  const uploadPending = useCallback(
    async (file: File, note: string) => {
      const form = new FormData();
      form.append("file", file);
      if (note) form.append("note", note);
      if (inCall) form.append("context", "live");

      const response = await fetch("/api/conversation/upload", { method: "POST", body: form });
      const body = (await response.json()) as {
        turn?: ThreadTurn;
        liveText?: string;
        liveImage?: { mimeType: string; data: string };
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "The upload failed.");
      return body;
    },
    [inCall],
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    const file = pendingFile;
    if ((!text && !file) || busy || uploading) return;

    setDraft("");
    // Cleared before anything async can touch it, so a staged file can never
    // ride along with a later message.
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setError(null);
    setFiled(null);
    pinnedRef.current = true;

    // The upload route writes the user's turn itself, so the model call that
    // follows only asks for the reply.
    let answerOnly = false;

    if (file) {
      setUploading(true);
      try {
        const uploaded = await uploadPending(file, text);
        append({
          kind: "turn",
          role: "user",
          text: uploaded.turn?.text || text || `Shared ${file.name}`,
          attachment: { kind: uploaded.turn?.attachment?.kind ?? "file", name: file.name },
        });
        if (inCall) {
          if (uploaded.liveImage) sendToCall("", uploaded.liveImage);
          if (uploaded.liveText) sendToCall(uploaded.liveText, undefined, { silent: true });
          setUploading(false);
          return;
        }
        answerOnly = true;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The upload failed.");
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    if (inCall) {
      if (text) sendToCall(text);
      return;
    }

    if (!text && !answerOnly) return;
    setBusy(true);
    if (!answerOnly) append({ kind: "turn", role: "user", text });

    let modelItemId: number | null = null;
    const toolItemIds = new Map<string, number>();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answerOnly ? { answerOnly: true } : { text }),
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "The request failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";

      const handleEvent = (event: StreamEvent) => {
        if (event.type === "text") {
          if (modelItemId === null) {
            modelItemId = append({ kind: "turn", role: "model", text: event.delta });
          } else {
            const id = modelItemId;
            setItems((current) =>
              current.map((item) =>
                item.id === id && item.kind === "turn" ? { ...item, text: item.text + event.delta } : item,
              ),
            );
          }
        } else if (event.type === "tool") {
          modelItemId = null;
          const existing = toolItemIds.get(event.name);
          if (event.status === "running" || existing === undefined) {
            toolItemIds.set(event.name, append({ kind: "tool", name: event.name, status: event.status }));
          } else {
            setItems((current) =>
              current.map((item) =>
                item.id === existing && item.kind === "tool" ? { ...item, status: event.status } : item,
              ),
            );
          }
          if (event.name === "start_deep_research" && event.status === "done") void refreshResearch();
        } else if (event.type === "error") {
          setError(event.message);
        }
      };

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });

        let boundary = pending.indexOf("\n\n");
        while (boundary !== -1) {
          const chunk = pending.slice(0, boundary).trim();
          pending = pending.slice(boundary + 2);
          if (chunk.startsWith("data:")) {
            try {
              handleEvent(JSON.parse(chunk.slice(5).trim()) as StreamEvent);
            } catch {
              // Skip a malformed chunk rather than killing the stream.
            }
          }
          boundary = pending.indexOf("\n\n");
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  }, [append, busy, draft, inCall, pendingFile, refreshResearch, sendToCall, uploadPending, uploading]);

  const fileNow = useCallback(async () => {
    setFiling(true);
    setFiled(null);
    try {
      const body = (await (
        await fetch("/api/conversation/file", { method: "POST" })
      ).json()) as { filed?: string[]; filing?: boolean; error?: string };
      if (body.error) throw new Error(body.error);
      setFiled(
        body.filed?.length
          ? `Filed into memory: ${body.filed.join(", ")}.`
          : body.filing
            ? "Still filing into memory in the background."
            : "Nothing new to file.",
      );
      await loadThread();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not file the conversation.");
    } finally {
      setFiling(false);
    }
  }, [loadThread]);

  const banner = error ?? callError;

  return (
    <section className="talk-page chat-page">
      <header className="talk-heading">
        <div>
          <p className="eyebrow">One conversation, typed or spoken</p>
          <h1>{assistantName}</h1>
        </div>
        <p>
          Type, or press Call to talk out loud. Both land in the same thread, so {assistantName} carries the whole
          conversation either way.
        </p>
      </header>

      {banner ? (
        <div className="error-banner" role="alert">
          <span>{banner}</span>
          <button
            onClick={() => {
              setError(null);
              clearCallError();
            }}
            type="button"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <SetupPanel />

      {inCall ? (
        <div className="talk-status-strip">
          <span className="talk-connection" data-state={status}>
            <span aria-hidden="true" />
            {CALL_STATUS_LABEL[status] ?? "In a call"}
          </span>
          <span className="talk-mic" aria-label={`Microphone level ${Math.round(micLevel * 100)} percent`}>
            <span className="talk-mic-fill" style={{ transform: `scaleX(${Math.max(0.02, micLevel)})` }} />
          </span>
          <span className="talk-mode-chip">{modes.find((mode) => mode.id === modeId)?.name}</span>
          <AbletonChip />
          <button
            className="talk-mute-button"
            data-muted={muted ? "true" : "false"}
            onClick={() => setMuted(!muted)}
            type="button"
          >
            {muted ? "Speaker off" : "Speaker on"}
          </button>
          <button className="talk-end-button" onClick={() => void endCall()} type="button">
            End call
          </button>
        </div>
      ) : null}

      {inCall && idleSecondsLeft !== null ? (
        <div className="talk-idle-warning" role="status">
          <span>Quiet for a while. Hanging up in {idleSecondsLeft}s.</span>
          <button onClick={stayAlive} type="button">
            Keep it open
          </button>
        </div>
      ) : null}

      {openJobs.length > 0 ? (
        <div className="chat-research-strip" role="status">
          <WorkingDots
            label={`Deep research running: ${openJobs.map((job) => `"${job.query}"`).join(", ")} (up to 20 minutes)`}
          />
        </div>
      ) : null}

      {filed ? <p className="chat-filed-note">{filed}</p> : null}

      <div
        className="talk-stream chat-stream"
        onScroll={(event) => {
          const element = event.currentTarget;
          pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
        ref={streamRef}
      >
        {items.length === 0 && callTurns.length === 0 ? (
          <p className="talk-stream-hint">
            Ask for something specific, or press Call and think out loud. {assistantName} reads your studio files,
            searches the web, works Ableton, and can launch deep research when you ask for it.
          </p>
        ) : null}

        {items.map((item) => {
          if (item.kind === "tool") {
            return (
              <p className="talk-tool-chip" data-running={item.status === "running" ? "true" : "false"} key={item.id}>
                <span aria-hidden="true" />
                {item.name} {item.status === "running" ? "running" : item.status === "error" ? "failed" : "done"}
              </p>
            );
          }
          if (item.kind === "notice") {
            return (
              <p className="chat-notice" key={item.id}>
                {item.text}
              </p>
            );
          }
          return (
            <article className="talk-turn" data-side={item.role === "user" ? "user" : "assistant"} key={item.id}>
              <span className="talk-turn-speaker">{item.role === "user" ? userName : assistantName}</span>
              {item.attachment ? (
                <p className="chat-attachment-line">
                  {item.attachment.kind}: {item.attachment.name}
                </p>
              ) : null}
              {item.role === "user" ? (
                <p className="talk-turn-text">{item.text}</p>
              ) : (
                <div className="talk-turn-text chat-markdown">
                  <Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown>
                </div>
              )}
            </article>
          );
        })}

        {/* The live call's fragments, replaced by the merged versions on hangup. */}
        {callTurns.map((turn) =>
          turn.speaker === TOOL_SPEAKER ? (
            <p
              className="talk-tool-chip"
              data-running={runningTools.has(turn.text) ? "true" : "false"}
              key={`live-${turn.id}`}
            >
              <span aria-hidden="true" />
              {turn.text}
            </p>
          ) : (
            <article
              className="talk-turn"
              data-side={turn.speaker === userName ? "user" : "assistant"}
              key={`live-${turn.id}`}
            >
              <span className="talk-turn-speaker">{turn.speaker}</span>
              <p className="talk-turn-text">{turn.text}</p>
            </article>
          ),
        )}

        {busy || uploading ? (
          <p className="talk-stream-hint">
            <WorkingDots label={uploading ? "Reading the file" : "Thinking"} />
          </p>
        ) : null}
      </div>

      <div className="talk-composer-shell">
        {pendingFile ? (
          <p className="chat-pending-file">
            <span>{pendingFile.name}</span>
            <button
              onClick={() => {
                setPendingFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              type="button"
              aria-label="Remove attachment"
            >
              &times;
            </button>
          </p>
        ) : null}

        <div className="talk-composer chat-composer">
          <input
            accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.md,.csv,.json,.mid,.midi"
            hidden
            onChange={(event) => setPendingFile(event.target.files?.[0] ?? null)}
            ref={fileInputRef}
            type="file"
          />
          <button
            className="chat-attach-button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach an image, PDF, text file, or MIDI file"
            type="button"
          >
            Attach
          </button>

          <textarea
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={
              inCall
                ? `Type to ${assistantName} instead of speaking`
                : `Tell ${assistantName} what to do. Shift+Enter for a new line.`
            }
            rows={Math.min(6, Math.max(1, draft.split("\n").length))}
            value={draft}
          />

          {inCall ? null : (
            <div className="chat-call-wrap">
              <button className="chat-call-button" onClick={() => setModePickerOpen((open) => !open)} type="button">
                Call
              </button>
              {modePickerOpen ? (
                <div className="chat-mode-popover" role="menu">
                  {modes.map((mode) => (
                    <button key={mode.id} onClick={() => void startCall(mode.id)} role="menuitem" type="button">
                      <strong>{mode.name}</strong>
                      <span>{mode.description}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          <button disabled={(!draft.trim() && !pendingFile) || busy || uploading} onClick={() => void send()} type="button">
            Send
          </button>
        </div>

        <p className="chat-session-row">
          <button className="chat-end-button" disabled={filing} onClick={() => void fileNow()} type="button">
            {filing ? "Filing..." : "File to memory now"}
          </button>
          <span>The conversation files itself into memory daily; this does it on the spot.</span>
        </p>
      </div>
    </section>
  );
}
