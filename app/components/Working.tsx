"use client";

/**
 * One place that answers "is anything happening right now?".
 *
 * clientFetch tracks requests explicitly. Streaming and non-request work
 * owns a beginWork receipt for its entire lifetime.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { subscribe, workSnapshot } from "@/lib/work-store";
export { beginWork } from "@/lib/work-store";

/** The label of the most recent in-flight job, or null when the app is idle. */
export function useWorking() {
  return useSyncExternalStore(
    subscribe,
    workSnapshot,
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
