"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Which brain writes MIDI. Sits on the Talk setup screen next to the Ableton
 * machine picker, because both answer the same question: where does the work
 * actually happen.
 */

type Backend = "gemini" | "anthropic-api" | "claude-code";

type SettingsState = {
  composer: { backend: Backend };
  hasAnthropicKey: boolean;
  hasClaudeCode: boolean;
};

const OPTIONS: { id: Backend; label: string; blurb: string }[] = [
  {
    id: "gemini",
    label: "Gemini",
    blurb: "Default. Uses the same Gemini key as your voice sessions, so there is nothing else to set up.",
  },
  {
    id: "anthropic-api",
    label: "Anthropic API",
    blurb: "Claude Fable 5, billed per request against your own Anthropic key.",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    blurb: "Claude Fable 5 through the claude CLI on this machine. Cheaper if you already subscribe.",
  },
];

export function ComposerPanel() {
  const [state, setState] = useState<SettingsState | null>(null);
  const [open, setOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const body = (await response.json()) as SettingsState;
      if (mountedRef.current) setState(body);
    } catch {
      if (mountedRef.current) setState(null);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const save = useCallback(async (payload: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as SettingsState & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not save the setting.");
      if (mountedRef.current) setState(body);
    } catch (caught) {
      if (mountedRef.current) setError(caught instanceof Error ? caught.message : "Could not save the setting.");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  if (!state) return null;

  const current = OPTIONS.find((option) => option.id === state.composer.backend) ?? OPTIONS[0];
  const needsKey = state.composer.backend === "anthropic-api" && !state.hasAnthropicKey;
  const missingCli = state.composer.backend === "claude-code" && !state.hasClaudeCode;

  return (
    <div className="composer-panel">
      <div className="composer-panel-summary">
        <span className="composer-chip" data-warn={needsKey || missingCli ? "true" : "false"}>
          <span aria-hidden="true" />
          MIDI written by {current.label}
        </span>
        <button onClick={() => setOpen((value) => !value)} type="button">
          {open ? "Close" : "Change"}
        </button>
      </div>

      {needsKey ? (
        <p className="composer-panel-warning">
          No Anthropic API key is saved, so composing will fail. Paste one below.
        </p>
      ) : null}
      {missingCli ? (
        <p className="composer-panel-warning">
          The claude CLI is not on this machine&apos;s PATH, so composing will fail. Install Claude Code and sign in,
          or pick a different backend.
        </p>
      ) : null}

      {open ? (
        <div className="composer-panel-body">
          {error ? <p className="composer-panel-error">{error}</p> : null}
          <ul>
            {OPTIONS.map((option) => (
              <li key={option.id}>
                <button
                  data-current={state.composer.backend === option.id ? "true" : "false"}
                  disabled={busy}
                  onClick={() => void save({ composerBackend: option.id })}
                  type="button"
                >
                  <span className="composer-option-name">{option.label}</span>
                  <span className="composer-option-blurb">{option.blurb}</span>
                </button>
              </li>
            ))}
          </ul>

          {state.composer.backend === "anthropic-api" ? (
            <div className="composer-panel-key">
              <input
                onChange={(event) => setKeyDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && keyDraft.trim()) {
                    event.preventDefault();
                    void save({ anthropicApiKey: keyDraft.trim() }).then(() => setKeyDraft(""));
                  }
                }}
                placeholder={state.hasAnthropicKey ? "Replace the saved Anthropic key" : "Paste your Anthropic API key"}
                type="password"
                value={keyDraft}
              />
              <button
                disabled={busy || !keyDraft.trim()}
                onClick={() => void save({ anthropicApiKey: keyDraft.trim() }).then(() => setKeyDraft(""))}
                type="button"
              >
                {state.hasAnthropicKey ? "Replace" : "Save key"}
              </button>
            </div>
          ) : null}

          <p className="composer-panel-hint">
            This only changes who writes MIDI when you ask for a part. The conversation itself always runs on Gemini
            Live.
          </p>
        </div>
      ) : null}
    </div>
  );
}
