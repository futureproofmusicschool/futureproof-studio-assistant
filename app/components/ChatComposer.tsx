"use client";
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { TalkMode } from "@/lib/talk";

type Props = {
  assistantName: string; publicPreview: boolean; inCall: boolean; busy: boolean; uploading: boolean;
  modes: TalkMode[]; modePickerOpen: boolean; setModePickerOpen: Dispatch<SetStateAction<boolean>>;
  startCall: (id: string) => Promise<void>; filing: boolean; fileNow: () => Promise<void>;
  onSend: (text: string, file: File | null) => boolean;
};
export function ChatComposer({ assistantName, publicPreview, inCall, busy, uploading, modes, modePickerOpen, setModePickerOpen, startCall, filing, fileNow, onSend }: Props) {
  const [draft, setDraft] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const send = () => {
    if (!onSend(draft.trim(), pendingFile)) return;
    setDraft("");
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  return (
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
            disabled={publicPreview}
            onClick={() => fileInputRef.current?.click()}
            title="Attach an image, PDF, text file, or MIDI file"
            type="button"
          >
            Attach
          </button>

          <textarea
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (publicPreview) return;
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={
              publicPreview
                ? "Public preview uses generic studio content."
                : inCall
                ? `Type to ${assistantName} instead of speaking`
                : `Tell ${assistantName} what to do. Shift+Enter for a new line.`
            }
            readOnly={publicPreview}
            rows={Math.min(6, Math.max(1, draft.split("\n").length))}
            value={draft}
          />

          {inCall ? null : (
            <div className="chat-call-wrap">
              <button
                className="chat-call-button"
                disabled={publicPreview}
                onClick={() => setModePickerOpen((open) => !open)}
                type="button"
              >
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

          <button
            disabled={publicPreview || (!draft.trim() && !pendingFile) || busy || uploading}
            onClick={() => void send()}
            type="button"
          >
            Send
          </button>
        </div>

        <p className="chat-session-row">
          {publicPreview ? (
            <>
              <span className="public-preview-lock">Preview safe</span>
              <span>No private conversation, contacts, or studio information is loaded here.</span>
            </>
          ) : (
            <>
              <button className="chat-end-button" disabled={filing} onClick={() => void fileNow()} type="button">
                {filing ? "Filing..." : "File to memory now"}
              </button>
              <span>The conversation files itself into memory daily; this does it on the spot.</span>
            </>
          )}
        </p>
      </div>
  );
}
