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

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function workSnapshot() { return snapshot; }
