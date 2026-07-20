"use client";

import { Fragment, type ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { InterviewTemplate, TranscriptSummary } from "@/lib/interviews";

type InterviewsViewProps = {
  assistantName: string;
  initialVoiceServerRunning: boolean;
  templates: InterviewTemplate[];
};

type TranscriptResponse = {
  transcripts?: TranscriptSummary[];
  error?: string;
};

const HANDOFF_KEY = "studio-assistant-chat-handoff-draft";

function inlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((token, index) => {
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

function transcriptMarkdown(contents: string) {
  return contents.split("\n").map((line, index) => {
    if (line.startsWith("# ")) {
      return <h3 key={index}>{line.slice(2)}</h3>;
    }
    if (!line.trim()) {
      return <span className="interview-transcript-gap" key={index} />;
    }
    return <p key={index}>{inlineMarkdown(line, `transcript-${index}`)}</p>;
  });
}

function formatSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

export function InterviewsView({
  assistantName,
  initialVoiceServerRunning,
  templates,
}: InterviewsViewProps) {
  const router = useRouter();
  const [selectedTemplate, setSelectedTemplate] = useState(templates[0]?.id ?? "");
  const [topic, setTopic] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [voiceServerRunning, setVoiceServerRunning] = useState(initialVoiceServerRunning);
  const [transcripts, setTranscripts] = useState<TranscriptSummary[]>([]);
  const [transcriptsLoading, setTranscriptsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [openFile, setOpenFile] = useState<string>();
  const [openContents, setOpenContents] = useState<string>();
  const activeTemplate = templates.find((template) => template.id === selectedTemplate);

  useEffect(() => {
    const controller = new AbortController();
    const loadTranscripts = async () => {
      try {
        const response = await fetch("/api/interviews/transcripts", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await response.json()) as TranscriptResponse;
        if (!response.ok || !body.transcripts) {
          throw new Error(body.error || "Could not load voice transcripts.");
        }
        setTranscripts(body.transcripts);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Could not load voice transcripts.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setTranscriptsLoading(false);
        }
      }
    };

    void loadTranscripts();
    return () => controller.abort();
  }, []);

  const prepare = async () => {
    if (!selectedTemplate || preparing) {
      return;
    }

    setPreparing(true);
    setPrepared(false);
    setError(undefined);
    try {
      const response = await fetch("/api/interviews/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: selectedTemplate, ...(activeTemplate?.needsTopic ? { topic } : {}) }),
      });
      const body = (await response.json()) as { ok?: boolean; voiceServerRunning?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        throw new Error(body.error || "Could not prepare the voice session.");
      }
      setVoiceServerRunning(Boolean(body.voiceServerRunning));
      setPrepared(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not prepare the voice session.");
    } finally {
      setPreparing(false);
    }
  };

  const viewTranscript = async (file: string) => {
    if (openFile === file) {
      setOpenFile(undefined);
      setOpenContents(undefined);
      return;
    }

    setError(undefined);
    setOpenFile(file);
    setOpenContents(undefined);
    try {
      const response = await fetch(`/api/interviews/transcripts/${encodeURIComponent(file)}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as { contents?: string; error?: string };
      if (!response.ok || typeof body.contents !== "string") {
        throw new Error(body.error || "Could not open the transcript.");
      }
      setOpenContents(body.contents);
    } catch (caught) {
      setOpenFile(undefined);
      setError(caught instanceof Error ? caught.message : "Could not open the transcript.");
    }
  };

  const fileIntoMemory = (file: string) => {
    const draft = `Read voice/transcripts/${file} and file it: studio facts into .claude/rules/studio-context.md, taste and decisions into memory/, project state into memory/working-self.md, tasks onto the board. Verify any spoken file paths with ls before saving. Report what you filed where.`;
    window.sessionStorage.setItem(HANDOFF_KEY, draft);
    router.push("/chat");
  };

  return (
    <section className="interviews-page">
      <header className="interviews-heading">
        <div>
          <p className="eyebrow">Voice gathers, text thinks</p>
          <h1>Interviews</h1>
        </div>
        <p>A focused listening session, followed by a deliberate handoff.</p>
      </header>

      {error ? (
        <div className="interviews-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(undefined)} type="button">Dismiss</button>
        </div>
      ) : null}

      <div className="interview-flow">
        <section className="interview-zone" aria-labelledby="purpose-heading">
          <div className="interview-step" aria-hidden="true">01</div>
          <div className="interview-zone-body">
            <header className="interview-zone-heading">
              <div>
                <h2 id="purpose-heading">Choose a purpose</h2>
                <p>This becomes the listener&apos;s one-page briefing.</p>
              </div>
            </header>

            <div className="interview-template-grid">
              {templates.map((template) => (
                <label
                  className="interview-template"
                  data-selected={selectedTemplate === template.id ? "true" : "false"}
                  key={template.id}
                >
                  <input
                    checked={selectedTemplate === template.id}
                    name="interview-template"
                    onChange={() => {
                      setSelectedTemplate(template.id);
                      setPrepared(false);
                    }}
                    type="radio"
                    value={template.id}
                  />
                  <span className="interview-template-index" aria-hidden="true">
                    {String(templates.indexOf(template) + 1).padStart(2, "0")}
                  </span>
                  <strong>{template.title}</strong>
                  <span>{template.description}</span>
                </label>
              ))}
            </div>

            {activeTemplate?.needsTopic ? (
              <label className="interview-topic">
                <span>Brainstorm topic</span>
                <input
                  onChange={(event) => {
                    setTopic(event.target.value);
                    setPrepared(false);
                  }}
                  placeholder="What do you want to explore?"
                  type="text"
                  value={topic}
                />
              </label>
            ) : null}
          </div>
        </section>

        <section className="interview-zone" aria-labelledby="session-heading">
          <div className="interview-step" aria-hidden="true">02</div>
          <div className="interview-zone-body interview-session-grid">
            <div>
              <header className="interview-zone-heading">
                <div>
                  <h2 id="session-heading">Prepare and speak</h2>
                  <p>Resolve the briefing before opening the voice room.</p>
                </div>
              </header>
              <button
                className="interview-prepare-button"
                disabled={preparing || !selectedTemplate || Boolean(activeTemplate?.needsTopic && !topic.trim())}
                onClick={prepare}
                type="button"
              >
                {preparing ? "Preparing..." : prepared ? "Briefing ready" : "Prepare session"}
              </button>
              {prepared ? <p className="interview-prepared-note">voice/prompt.md is ready for a new connection.</p> : null}
            </div>

            <div className="interview-launch-panel">
              <div className="interview-server-status" data-running={voiceServerRunning ? "true" : "false"}>
                <span aria-hidden="true" />
                Voice server {voiceServerRunning ? "running" : "not running"}
              </div>
              {!voiceServerRunning ? (
                <p className="interview-start-command">Start it with: <code>cd voice &amp;&amp; npm start</code></p>
              ) : null}
              <a className="interview-open-button" href="http://localhost:3015" rel="noreferrer" target="_blank">
                Open voice room <span aria-hidden="true">↗</span>
              </a>
              <p className="interview-boundary-copy">
                The voice agent only knows this briefing. It cannot see the repo, the board, or memory. {assistantName} reads the transcript afterward.
              </p>
            </div>
          </div>
        </section>

        <section className="interview-zone" aria-labelledby="transcripts-heading">
          <div className="interview-step" aria-hidden="true">03</div>
          <div className="interview-zone-body">
            <header className="interview-zone-heading interview-transcripts-heading">
              <div>
                <h2 id="transcripts-heading">Hand off the transcript</h2>
                <p>Review what was gathered, then draft the filing request in Chat.</p>
              </div>
              <span>{transcripts.length} saved</span>
            </header>

            <div className="interview-transcript-list">
              {transcriptsLoading ? <p className="interview-list-state">Loading transcripts...</p> : null}
              {!transcriptsLoading && transcripts.length === 0 ? (
                <p className="interview-list-state">No transcripts yet. Complete a voice session and it will appear here.</p>
              ) : null}
              {transcripts.map((transcript) => (
                <article className="interview-transcript-row" key={transcript.file}>
                  <div className="interview-transcript-summary">
                    <strong>{transcript.file}</strong>
                    <p>{transcript.preview}</p>
                    <span>
                      {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(transcript.date))}
                      {" · "}{formatSize(transcript.size)}
                    </span>
                  </div>
                  <div className="interview-transcript-actions">
                    <button onClick={() => void viewTranscript(transcript.file)} type="button">
                      {openFile === transcript.file ? "Close" : "View"}
                    </button>
                    <button className="interview-file-button" onClick={() => fileIntoMemory(transcript.file)} type="button">
                      File into memory
                    </button>
                  </div>
                  {openFile === transcript.file ? (
                    <div className="interview-transcript-view">
                      {openContents ? transcriptMarkdown(openContents) : <p>Opening transcript...</p>}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
