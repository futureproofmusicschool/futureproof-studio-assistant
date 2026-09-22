/** An overall deadline remains active while callers consume the response body. */
export function boundedFetch(input: string | URL, init: RequestInit = {}, timeoutMs = 240_000) {
  const deadline = AbortSignal.timeout(timeoutMs);
  return fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
}
export async function readWithDeadline<T>(read: () => Promise<T>, milliseconds: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { onTimeout(); reject(new Error("The response stream stopped making progress.")); }, milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}
