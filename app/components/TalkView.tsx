"use client";

import { useEffect, useRef, useState } from "react";
import { TOOL_SPEAKER, useGeminiLive, type EndedSession } from "@/hooks/useGeminiLive";
import type { TalkMode } from "@/lib/talk";

type TalkViewProps = {
  assistantName: string;
  userName: string;
  modes: TalkMode[];
};

const STATUS_LABEL: Record<string, string> = {
  idle: "Ready",
  connecting: "Connecting",
  live: "Listening",
  ended: "Session ended",
  error: "Problem",
};

export function TalkView({ assistantName, userName, modes }: TalkViewProps) {
  const {
    status,
    error,
    turns,
    toolActivity,
    micLevel,
    muted,
    setMuted,
    connect,
    disconnect,
    sendText,
    clearError,
  } = useGeminiLive({ userLabel: userName, assistantLabel: assistantName });

  const [modeId, setModeId] = useState(modes[0]?.id ?? "open");
  const [draft, setDraft] = useState("");
  const [ending, setEnding] = useState(false);
  const [ended, setEnded] = useState<(EndedSession & { mode: string }) | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  const activeMode = modes.find((mode) => mode.id === modeId);
  const live = status === "live" || status === "connecting";

  useEffect(() => {
    const element = streamRef.current;
    if (element && pinnedRef.current) element.scrollTop = element.scrollHeight;
  }, [turns]);

  const start = async () => {
    setEnded(null);
    pinnedRef.current = true;
    await connect(modeId);
  };

  const end = async () => {
    setEnding(true);
    try {
      const result = await disconnect();
      setEnded({ ...result, mode: activeMode?.name ?? modeId });
    } finally {
      setEnding(false);
    }
  };

  const submitDraft = () => {
    if (!draft.trim() || status !== "live") return;
    sendText(draft);
    setDraft("");
    pinnedRef.current = true;
  };

  return (
    <section className="talk-page">
      <header className="talk-heading">
        <div>
          <p className="eyebrow">One conversation, spoken and written</p>
          <h1>Talk</h1>
        </div>
        <p>{assistantName} hears you, answers out loud, and reads your studio files when the conversation needs them.</p>
      </header>

      {error ? (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={clearError} type="button">
            Dismiss
          </button>
        </div>
      ) : null}

      {live ? (
        <div className="talk-status-strip">
          <span className="talk-connection" data-state={status}>
            <span aria-hidden="true" />
            {STATUS_LABEL[status]}
          </span>
          <span className="talk-mic" aria-label={`Microphone level ${Math.round(micLevel * 100)} percent`}>
            <span className="talk-mic-fill" style={{ transform: `scaleX(${Math.max(0.02, micLevel)})` }} />
          </span>
          <span className="talk-mode-chip">{activeMode?.name}</span>
          <button
            className="talk-mute-button"
            data-muted={muted ? "true" : "false"}
            onClick={() => setMuted(!muted)}
            type="button"
          >
            {muted ? "Speaker off" : "Speaker on"}
          </button>
          <button className="talk-end-button" disabled={ending} onClick={() => void end()} type="button">
            {ending ? "Saving..." : "End session"}
          </button>
        </div>
      ) : null}

      {live ? (
        <>
          <div
            className="talk-stream"
            onScroll={(event) => {
              const element = event.currentTarget;
              pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
            }}
            ref={streamRef}
          >
            {turns.length === 0 ? (
              <p className="talk-stream-hint">
                {status === "connecting" ? "Opening the session..." : "Say something. Both sides show up here as you go."}
              </p>
            ) : null}
            {turns.map((turn) =>
              turn.speaker === TOOL_SPEAKER ? (
                <p className="talk-tool-chip" key={turn.id}>
                  <span aria-hidden="true" />
                  {turn.text}
                </p>
              ) : (
                <article
                  className="talk-turn"
                  data-side={turn.speaker === userName ? "user" : "assistant"}
                  key={turn.id}
                >
                  <span className="talk-turn-speaker">{turn.speaker}</span>
                  <p className="talk-turn-text">{turn.text}</p>
                </article>
              ),
            )}
          </div>

          <div className="talk-composer-shell">
            <div className="talk-composer">
              <input
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitDraft();
                  }
                }}
                placeholder={`Type to ${assistantName} instead of speaking`}
                value={draft}
              />
              <button disabled={!draft.trim() || status !== "live"} onClick={submitDraft} type="button">
                Send
              </button>
            </div>
            {toolActivity.length > 0 ? (
              <p className="talk-tool-summary">
                {toolActivity.filter((entry) => entry.status === "running").length > 0
                  ? "Working with your files..."
                  : `${toolActivity.length} tool ${toolActivity.length === 1 ? "call" : "calls"} this session`}
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <div className="talk-setup">
          {ended ? (
            <div className="talk-ended">
              <h2>Session ended</h2>
              <p>
                {ended.savedPath
                  ? `Transcript saved: ${ended.savedPath}`
                  : "Nothing was said, so no transcript was saved."}
              </p>
              <p className="talk-ended-mode">Mode: {ended.mode}</p>
              {ended.drafts.length > 0 ? (
                <div className="talk-drafts">
                  <h3>Drafts written this session</h3>
                  <ul>
                    {ended.drafts.map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                  </ul>
                  <p>Nothing was sent. Read each draft before you send it yourself.</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="talk-mode-grid">
            {modes.map((mode) => (
              <label className="talk-mode" data-selected={modeId === mode.id ? "true" : "false"} key={mode.id}>
                <input
                  checked={modeId === mode.id}
                  name="talk-mode"
                  onChange={() => setModeId(mode.id)}
                  type="radio"
                  value={mode.id}
                />
                <strong>{mode.name}</strong>
                <span>{mode.description}</span>
              </label>
            ))}
          </div>

          <button className="talk-start-button" onClick={() => void start()} type="button">
            {ended ? "Start another session" : "Start talking"}
          </button>
          <p className="talk-setup-note">
            Your microphone opens when the session connects. {assistantName} can search the web and read your studio
            files, and can write an email draft, but never sends anything.
          </p>
        </div>
      )}
    </section>
  );
}
