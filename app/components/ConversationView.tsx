"use client";
import { clientFetch } from "@/lib/client-requests";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AbletonChip } from "@/components/AbletonPanel";
import { ProjectStatusRail } from "@/components/ProjectStatusRail";
import { SetupPanel } from "@/components/SetupPanel";
import { beginWork, WorkingDots } from "@/components/Working";
import { TOOL_SPEAKER } from "@/hooks/useGeminiLive";
import { useLiveSession } from "./LiveSessionProvider";
import { MicrophoneMeter } from "./MicrophoneMeter";
import { ChatComposer } from "./ChatComposer";
import { frameBuffer } from "@/lib/frame-buffer";
import type { TalkMode } from "@/lib/talk";

/**
 * One conversation, typed or spoken.
 *
 * There is no session to start and no session to end: the thread lives on the
 * server and this window is a view onto it. Typing goes to Gemini Flash over SSE;
 * pressing Call opens a Gemini Live socket whose turns land in the same thread,
 * so the two halves can see each other's context.
 */

type ConversationViewProps = {
  assistantName: string;
  userName: string;
  modes: TalkMode[];
  publicPreview?: boolean;
};

type NewStreamItem =
  | { kind: "turn"; role: "user" | "model"; text: string; attachment?: AttachmentInfo }
  | { kind: "tool"; name: string; status: "running" | "done" | "error" }
  | { kind: "progress"; text: string }
  | { kind: "notice"; text: string };

type StreamItem = NewStreamItem & { id: string | number };

type AttachmentInfo = { kind: string; name: string };

type ResearchJob = {
  id: string;
  query: string;
  status: "in_progress" | "completed" | "failed";
  reportPath?: string;
  documentId?: string;
  webViewLink?: string;
};

type StreamEvent =
  | { type: "status"; message: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: "running" | "done" | "error" }
  | { type: "done" }
  | { type: "error"; message: string };

type ThreadTurn = {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  attachment?: AttachmentInfo;
  createdAt?: number;
};

const PUBLIC_PREVIEW_ITEMS: StreamItem[] = [
  {
    id: -4,
    kind: "turn",
    role: "user",
    text: "The second drop still feels crowded. Tighten the drums and leave more room for the bass.",
  },
  {
    id: -3,
    kind: "turn",
    role: "model",
    text: "I’d keep the first fill, cut the repeat before beat four, and let the bass own that silence. I can make the variation in Live, place it in Arrangement, and save the decision with the project.",
  },
  { id: -2, kind: "tool", name: "arrange_live_clip", status: "done" },
  {
    id: -1,
    kind: "turn",
    role: "model",
    text: "Done. The new eight-bar variation is on the timeline and Live’s undo will revert the edit if you want the original back.",
  },
];

const RESEARCH_POLL_MS = 60_000;

const CALL_STATUS_LABEL: Record<string, string> = {
  connecting: "Connecting",
  live: "Listening",
  reconnecting: "Reconnecting",
};

const ConversationRow = memo(function ConversationRow({ item, assistantName, userName }: { item: StreamItem; assistantName: string; userName: string }) {
          if (item.kind === "tool") {
            return (
              <p className="talk-tool-chip" data-running={item.status === "running" ? "true" : "false"} >
                <span aria-hidden="true" />
                {item.name} {item.status === "running" ? "running" : item.status === "error" ? "failed" : "done"}
              </p>
            );
          }
          if (item.kind === "progress") {
            return (
              <article className="talk-turn" data-side="assistant"  role="status">
                <span className="talk-turn-speaker">{assistantName}</span>
                <div className="talk-turn-text">
                  <WorkingDots label={item.text} />
                </div>
              </article>
            );
          }
          if (item.kind === "notice") {
            return (
              <p className="chat-notice" >
                {item.text}
              </p>
            );
          }
          return (
            <article className="talk-turn" data-side={item.role === "user" ? "user" : "assistant"} >
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

});

export function ConversationView({ assistantName, userName, modes, publicPreview = false }: ConversationViewProps) {
  const [items, setItems] = useState<StreamItem[]>(() => (publicPreview ? PUBLIC_PREVIEW_ITEMS : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [research, setResearch] = useState<ResearchJob[]>([]);
  const [modePickerOpen, setModePickerOpen] = useState(false);
  const [modeId, setModeId] = useState(modes[0]?.id ?? "open");
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lastFiledDay, setLastFiledDay] = useState<string | null>(null);

  const activeCallRef = useRef(false);
  const callStartRef = useRef<number | null>(null);
  const sendingRef = useRef(false);
  const nextIdRef = useRef(1);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  const append = useCallback((item: NewStreamItem) => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    setItems((current) => [...current, { ...item, id }]);
    return id;
  }, []);

  const toStreamItems = useCallback((turns: ThreadTurn[]) => {
    return turns.map((turn) => {
      const id = turn.id;
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
      const body = (await (await clientFetch("/api/conversation", { cache: "no-store" })).json()) as {
        turns?: ThreadTurn[];
        lastFiledDay?: string | null;
      };
      const turns = body.turns ?? [];
      setItems(toStreamItems(turns.filter((turn) => !activeCallRef.current || !callStartRef.current || (turn.createdAt ?? 0) < callStartRef.current || turn.attachment)));
      setLastFiledDay(body.lastFiledDay ?? null);
    } catch {
      // An unreadable thread is an empty conversation, not an error worth a banner.
    }
  }, [toStreamItems]);

  useEffect(() => {
    if (!publicPreview) void loadThread();
  }, [loadThread, publicPreview]);

  // ------------------------------------------------------------------
  // The call
  // ------------------------------------------------------------------

  const {
    status,
    error: callError,
    turns: callTurns,
    toolActivity,
    meter,
    callStartedAt,
    muted,
    setMuted,
    idleSecondsLeft,
    stayAlive,
    connect,
    disconnect,
    sendText: sendToCall,
    clearError: clearCallError,
  } = useLiveSession();

  const inCall = status === "connecting" || status === "live" || status === "reconnecting";
  activeCallRef.current = inCall;
  callStartRef.current = callStartedAt;
  useEffect(() => {
    if (!publicPreview && (status === "ended" || status === "error")) void loadThread();
  }, [status, loadThread, publicPreview]);
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

  const researchRef = useRef<ResearchJob[]>([]);
  const researchPending = useRef(false);
  const refreshResearch = useCallback(async () => {
    if (researchPending.current) return;
    researchPending.current = true;
    try {
      const listed = (await (await clientFetch("/api/chat/research")).json()) as { jobs?: ResearchJob[] };
      const jobs = listed.jobs ?? [];

      for (const job of jobs.filter((entry) => entry.status === "in_progress")) {
        const polled = (await (await clientFetch(`/api/chat/research?id=${encodeURIComponent(job.id)}`)).json()) as {
          job?: ResearchJob;
        };
        if (polled.job && polled.job.status !== "in_progress") {
          append({
            kind: "notice",
            text:
              polled.job.status === "completed"
                ? `Deep research finished: "${polled.job.query}". Report saved to ${polled.job.webViewLink ?? polled.job.reportPath ?? "Google Docs"}.`
                : `Deep research failed: "${polled.job.query}".`,
          });
        }
      }

      const refreshed = (await (await clientFetch("/api/chat/research")).json()) as { jobs?: ResearchJob[] };
      const nextJobs = refreshed.jobs ?? jobs;
      for (const previous of researchRef.current) {
        const next = nextJobs.find((job) => job.id === previous.id);
        // Jobs already completed by the scheduler will not enter the loop above.
        if (previous.status === "in_progress" && next && next.status !== "in_progress" && jobs.find((job) => job.id === next.id)?.status !== "in_progress") {
          append({ kind: "notice", text: next.status === "completed" ? `Deep research finished: "${next.query}". Report saved to ${next.webViewLink ?? "Google Docs"}.` : `Deep research failed: "${next.query}".` });
        }
      }
      researchRef.current = nextJobs;
      setResearch(nextJobs);
    } catch {
      // Polling never raises its own banner.
    } finally { researchPending.current = false; }
  }, [append]);

  useEffect(() => {
    if (!publicPreview) void refreshResearch();
  }, [publicPreview, refreshResearch]);

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

      const response = await clientFetch("/api/conversation/upload", { method: "POST", body: form });
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

  const send = useCallback(async (text: string, file: File | null) => {
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

    const finishWork = beginWork("Working on your message");
    let modelItemId: number | null = null;
    let progressItemId: number | null = append({
      kind: "progress",
      text: "Got it — I’m working on that now.",
    });
    const toolItemIds = new Map<string, number>();
    let flushStream = () => {};

    const removeProgress = () => {
      if (progressItemId === null) return;
      const id = progressItemId;
      progressItemId = null;
      setItems((current) => current.filter((item) => item.id !== id));
    };

    try {
      const response = await clientFetch("/api/chat", {
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

      const applyEvent = (event: StreamEvent) => {
        if (event.type === "status") {
          if (progressItemId !== null) {
            const id = progressItemId;
            setItems((current) =>
              current.map((item) =>
                item.id === id && item.kind === "progress" ? { ...item, text: event.message } : item,
              ),
            );
          }
        } else if (event.type === "text") {
          removeProgress();
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
        } else if (event.type === "done") {
          removeProgress();
        } else if (event.type === "error") {
          removeProgress();
          setError(event.message);
        }
      };

      const buffered = frameBuffer((delta) => applyEvent({ type: "text", delta }));
      flushStream = buffered.flush;
      const handleEvent = (event: StreamEvent) => {
        if (event.type === "text") buffered.push(event.delta);
        else { buffered.flush(); applyEvent(event); }
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
      removeProgress();
      setError(caught instanceof Error ? caught.message : "The request failed.");
    } finally {
      flushStream();
      finishWork();
      removeProgress();
      setBusy(false);
    }
  }, [append, inCall, refreshResearch, sendToCall, uploadPending]);

  const fileNow = useCallback(async () => {
    if (publicPreview) return;
    setFiling(true);
    setFiled(null);
    try {
      const body = (await (
        await clientFetch("/api/conversation/file", { method: "POST" })
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
  }, [loadThread, publicPreview]);

  const banner = error ?? callError;

  return (
    <section className="talk-page chat-page" data-public-preview={publicPreview ? "true" : "false"}>
      {publicPreview ? null : <SetupPanel />}

      <div className="talk-workspace">
        <div className="talk-conversation-column">
          {banner && !publicPreview ? (
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

          {inCall ? (
            <div className="talk-status-strip">
              <span className="talk-connection" data-state={status}>
                <span aria-hidden="true" />
                {CALL_STATUS_LABEL[status] ?? "In a call"}
              </span>
              <MicrophoneMeter meter={meter} />
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

          <div className="talk-stream-label" aria-hidden="true">
            <span>{publicPreview ? "Sample studio log" : "Live studio log"}</span>
            <span>{items.length + (inCall ? callTurns.length : 0)} entries</span>
          </div>

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

        {items.map((item) => <ConversationRow key={item.id} item={item} assistantName={assistantName} userName={userName} />)}

        {/* The live call's fragments, replaced by the merged versions on hangup. */}
        {(inCall ? callTurns : []).map((turn) =>
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

        {uploading ? (
          <p className="talk-stream-hint">
            <WorkingDots label="Reading the file" />
          </p>
        ) : null}
          </div>
        </div>

        <ProjectStatusRail
          inCall={inCall}
          lastFiledDay={lastFiledDay}
          meter={meter}
          publicPreview={publicPreview}
        />
      </div>

      <ChatComposer assistantName={assistantName} publicPreview={publicPreview} inCall={inCall}
        busy={busy} uploading={uploading} modes={modes} modePickerOpen={modePickerOpen}
        setModePickerOpen={setModePickerOpen} startCall={startCall} filing={filing} fileNow={fileNow}
        onSend={(text, file) => {
          if (publicPreview || (!text && !file) || busy || uploading || sendingRef.current) return false;
          if (inCall && status !== "live") return false;
          if (inCall && !file) return sendToCall(text);
          sendingRef.current = true;
          void send(text, file).finally(() => { sendingRef.current = false; });
          return true;
        }} />
    </section>
  );
}
