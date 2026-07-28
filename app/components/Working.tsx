"use client";

/**
 * One place that answers "is anything happening right now?".
 *
 * Every panel in this app already talks to the server with plain fetch, so the
 * store instruments fetch once and counts the calls that are in flight. That
 * means a new panel gets the indicator for free instead of having to remember
 * to wire one up. Work that is not a fetch (a Live session opening, audio
 * starting) calls beginWork directly.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Job = { id: number; label: string };

let jobs: Job[] = [];
let nextJobId = 0;
let snapshot: string | null = null;
const listeners = new Set<() => void>();

function publish() {
  const next = jobs.length > 0 ? jobs[jobs.length - 1].label : null;
  if (next === snapshot) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

/** Announce work that is not a fetch. Call the returned function when it ends. */
export function beginWork(label: string) {
  const id = (nextJobId += 1);
  jobs = [...jobs, { id, label }];
  publish();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    jobs = jobs.filter((job) => job.id !== id);
    publish();
  };
}

/** Background polls run forever; they are not "something happening". */
const SILENT = [/^\/api\/ableton\/health/];

function labelFor(path: string, method: string) {
  const reading = method === "GET" || method === "HEAD";
  if (path.startsWith("/api/talk/tools")) return "Working with your files";
  if (path.startsWith("/api/talk/config")) return "Opening the session";
  if (path.startsWith("/api/talk/transcripts")) return "Saving the transcript";
  if (path.startsWith("/api/board")) return reading ? "Loading the board" : "Saving the board";
  if (path.startsWith("/api/contacts")) return reading ? "Loading contacts" : "Saving contacts";
  if (path.startsWith("/api/settings")) return reading ? "Loading settings" : "Saving settings";
  if (path.startsWith("/api/ableton/discover")) return "Scanning the network";
  if (path.startsWith("/api/ableton")) return "Talking to Live";
  return "Working";
}

function requestPath(input: RequestInfo | URL) {
  const raw =
    typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  try {
    const url = new URL(raw, window.location.href);
    return url.origin === window.location.origin ? url.pathname : null;
  } catch {
    return null;
  }
}

let instrumented = false;

function instrumentFetch() {
  if (instrumented || typeof window === "undefined") return;
  instrumented = true;

  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = requestPath(input);
    const tracked =
      path !== null && path.startsWith("/api/") && !SILENT.some((pattern) => pattern.test(path));
    if (!tracked) return original(input, init);

    const method = (
      init?.method ??
      (typeof input === "object" && "method" in input ? (input as Request).method : "GET")
    ).toUpperCase();
    const end = beginWork(labelFor(path, method));
    try {
      return await original(input, init);
    } finally {
      end();
    }
  };
}

function subscribe(listener: () => void) {
  instrumentFetch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The label of the most recent in-flight job, or null when the app is idle. */
export function useWorking() {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => null,
  );
}

/**
 * Hold the label steady enough to read: nothing flashes for a request that
 * finishes in 80ms, and nothing blinks out before the eye lands on it.
 */
function useSettled(label: string | null, appearAfter = 160, minVisible = 500) {
  const [shown, setShown] = useState<string | null>(null);
  const shownRef = useRef<string | null>(null);
  const shownAtRef = useRef(0);

  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  useEffect(() => {
    if (label !== null) {
      if (shownRef.current !== null) {
        setShown(label);
        return;
      }
      const timer = window.setTimeout(() => {
        shownAtRef.current = Date.now();
        setShown(label);
      }, appearAfter);
      return () => window.clearTimeout(timer);
    }

    if (shownRef.current === null) return;
    const held = Date.now() - shownAtRef.current;
    const timer = window.setTimeout(() => setShown(null), Math.max(0, minVisible - held));
    return () => window.clearTimeout(timer);
  }, [appearAfter, label, minVisible]);

  return shown;
}

/** The header's global "something is happening" light. */
export function WorkingIndicator() {
  const label = useSettled(useWorking());
  // Keep the last label through the fade-out, so it does not flip to a
  // placeholder while it is still on screen.
  const lastLabel = useRef("Working");
  if (label) lastLabel.current = label;

  return (
    <div aria-live="polite" className="working-indicator" data-on={label ? "true" : "false"}>
      <span aria-hidden="true" className="working-spinner" />
      <span className="working-label">{label ?? lastLabel.current}</span>
    </div>
  );
}

/** Inline version for a panel that wants to say what it is busy with. */
export function WorkingDots({ label }: { label: string }) {
  return (
    <span className="working-dots" role="status">
      <span aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {label}
    </span>
  );
}
