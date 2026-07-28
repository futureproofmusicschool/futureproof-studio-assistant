"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SettingsState = {
  hasGeminiKey: boolean;
};

export function GeminiKeyPanel() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void fetch("/api/settings", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as SettingsState & { error?: string };
        if (!response.ok) throw new Error(body.error || "Could not read API key settings.");
        if (mountedRef.current) setHasKey(Boolean(body.hasGeminiKey));
      })
      .catch((caught) => {
        if (mountedRef.current) {
          setError(caught instanceof Error ? caught.message : "Could not read API key settings.");
          setHasKey(false);
        }
      });

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const save = useCallback(async () => {
    const geminiApiKey = draft.trim();
    if (!geminiApiKey) return;

    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geminiApiKey }),
      });
      const body = (await response.json()) as SettingsState & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not save the Gemini API key.");
      if (mountedRef.current) {
        setDraft("");
        setHasKey(Boolean(body.hasGeminiKey));
        setSaved(Boolean(body.hasGeminiKey));
      }
    } catch (caught) {
      if (mountedRef.current) {
        setError(caught instanceof Error ? caught.message : "Could not save the Gemini API key.");
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [draft]);

  return (
    <div className="api-key-panel">
      <div className="api-key-status" aria-live="polite">
        <span className="composer-chip" data-warn={hasKey === false ? "true" : "false"}>
          <span aria-hidden="true" />
          {hasKey === null ? "Checking for a saved key…" : hasKey ? "Gemini key saved" : "Gemini key needed"}
        </span>
        {saved ? <span className="api-key-saved">Updated</span> : null}
      </div>

      {error ? <p className="settings-error">{error}</p> : null}

      <div className="api-key-entry">
        <label htmlFor="gemini-api-key">
          <span>Gemini API key</span>
          <input
            autoCapitalize="none"
            autoComplete="off"
            id="gemini-api-key"
            onChange={(event) => {
              setDraft(event.target.value);
              setSaved(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draft.trim()) {
                event.preventDefault();
                void save();
              }
            }}
            placeholder={hasKey ? "Paste a new key to replace the saved one" : "Paste your Gemini API key"}
            spellCheck={false}
            type="password"
            value={draft}
          />
        </label>
        <button disabled={busy || !draft.trim()} onClick={() => void save()} type="button">
          {busy ? "Saving…" : hasKey ? "Replace key" : "Save key"}
        </button>
      </div>

      <p className="api-key-note">
        Stored only in this machine&apos;s gitignored <code>.env</code> file. The saved value is never sent back to
        the page.
      </p>
    </div>
  );
}
