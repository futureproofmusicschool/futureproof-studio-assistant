"use client";

import { useEffect, useState } from "react";

/**
 * First-run card on the Talk screen: shown only while no Gemini API key is
 * saved. The key goes straight into the repo-root .env server-side and is
 * never sent back to the browser.
 */
export function SetupPanel() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/settings", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { hasGeminiKey?: boolean }) => {
        if (active) setHasKey(Boolean(body.hasGeminiKey));
      })
      .catch(() => {
        if (active) setHasKey(null);
      });
    return () => {
      active = false;
    };
  }, []);

  if (hasKey !== false) return null;

  const save = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geminiApiKey: draft.trim() }),
      });
      const body = (await response.json()) as { hasGeminiKey?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not save the key.");
      setDraft("");
      setHasKey(Boolean(body.hasGeminiKey));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the key.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="setup-panel" role="region" aria-label="First-run setup">
      <h2>One thing before the first session</h2>
      <p>
        Talking needs a Google Gemini API key (free tier works). Create one at aistudio.google.com, paste it here, and
        it's saved to the gitignored .env on this machine only.
      </p>
      {error ? <p className="setup-panel-error">{error}</p> : null}
      <div className="setup-panel-row">
        <input
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
          placeholder="Paste your Gemini API key"
          type="password"
          value={draft}
        />
        <button disabled={saving || !draft.trim()} onClick={() => void save()} type="button">
          {saving ? "Saving..." : "Save key"}
        </button>
      </div>
    </div>
  );
}
