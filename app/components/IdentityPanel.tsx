"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Names. The assistant's name is what shows in the header and what it calls
 * itself out loud; the artist's name is how it addresses them and how their
 * turns are labelled in transcripts. Both live in assistant.json.
 *
 * Renaming here does not touch CLAUDE.local.md or voice/prompt.md, which is
 * where the assistant's personality is actually written, so the hint says so.
 */
export function IdentityPanel() {
  const router = useRouter();
  const [assistantName, setAssistantName] = useState("");
  const [userName, setUserName] = useState("");
  const [saved, setSaved] = useState<{ assistantName: string; userName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void fetch("/api/settings", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { assistantName?: string; userName?: string }) => {
        if (!mountedRef.current) return;
        setSaved({ assistantName: body.assistantName ?? "", userName: body.userName ?? "" });
        setAssistantName(body.assistantName ?? "");
        setUserName(body.userName ?? "");
      })
      .catch(() => {
        if (mountedRef.current) setError("Could not read assistant.json.");
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assistantName: assistantName.trim(), userName: userName.trim() }),
      });
      const body = (await response.json()) as { assistantName?: string; userName?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not save the names.");
      if (mountedRef.current) {
        setSaved({ assistantName: body.assistantName ?? "", userName: body.userName ?? "" });
        // The header is server-rendered from assistant.json, so re-fetch it.
        router.refresh();
      }
    } catch (caught) {
      if (mountedRef.current) setError(caught instanceof Error ? caught.message : "Could not save the names.");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [assistantName, router, userName]);

  if (!saved) return null;

  const dirty = assistantName.trim() !== saved.assistantName || userName.trim() !== saved.userName;
  const valid = Boolean(assistantName.trim() && userName.trim());

  return (
    <div className="settings-block">
      <h2>Names</h2>
      <p className="settings-block-hint">
        What the assistant is called, and what it calls you. The name shows in the header, in transcripts, and in
        everything it says.
      </p>
      {error ? <p className="settings-error">{error}</p> : null}
      <div className="settings-fields">
        <label>
          <span>Assistant name</span>
          <input
            onChange={(event) => setAssistantName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && dirty && valid) {
                event.preventDefault();
                void save();
              }
            }}
            placeholder="Assistant"
            value={assistantName}
          />
        </label>
        <label>
          <span>Your name</span>
          <input
            onChange={(event) => setUserName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && dirty && valid) {
                event.preventDefault();
                void save();
              }
            }}
            placeholder="You"
            value={userName}
          />
        </label>
        <button disabled={busy || !dirty || !valid} onClick={() => void save()} type="button">
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
      <p className="settings-block-hint">
        This renames the app. Who the assistant actually is lives in CLAUDE.local.md and voice/prompt.md; edit those
        too if you want more than a new label.
      </p>
    </div>
  );
}
