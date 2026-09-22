import { beginWork } from "./work-store";
/** Share concurrent GETs only. Completed cloud data is always revalidated. */
const reads = new Map<string, Promise<Response>>();
let revision = 0;
export function invalidateClientReads() {
  revision++;
  reads.clear();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("studio-data-invalidated"));
}
export function clientFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if ((init.method ?? "GET").toUpperCase() !== "GET" || init.signal) {
    return trackedFetch(input, init).then((response) => {
      if (response.ok && /\/api\/(settings|connectors|google)/.test(input)) invalidateClientReads();
      return response;
    });
  }
  const key = `${revision}:${input}`;
  let pending = reads.get(key);
  if (!pending) {
    pending = trackedFetch(input, init);
    reads.set(key, pending);
    const current = pending;
    void current.finally(() => { if (reads.get(key) === current) reads.delete(key); }).catch(() => {});
  }
  return pending.then((response) => response.clone());
}
/** Last-request-wins without aborting a shared read used by another panel. */
export function requestVersion() {
  let version = 0;
  return { next: () => ++version, current: (candidate: number) => candidate === version, invalidate: () => { version++; } };
}

async function trackedFetch(input: string, init: RequestInit) {
  const reading = (init.method ?? "GET") === "GET";
  const subject = input.startsWith("/api/settings") ? "settings" : input.startsWith("/api/contacts") ? "contacts" : input.startsWith("/api/board") ? "the board" : null;
  const label = subject ? `${reading ? "Loading" : "Saving"} ${subject}` : "Working";
  const finish = input.startsWith("/api/ableton/health") ? () => {} : beginWork(label);
  try { return await fetch(input, init); } finally { finish(); }
}
