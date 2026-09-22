/** Coalesce visual deltas without delaying input or losing the final chunk. */
export function frameBuffer(emit: (text: string) => void, schedule = requestAnimationFrame, cancel = cancelAnimationFrame) {
  let pending = "";
  let frame: number | null = null;
  const flush = () => {
    if (frame !== null) cancel(frame);
    frame = null;
    const text = pending;
    pending = "";
    if (text) emit(text);
  };
  return {
    push(text: string) { pending += text; if (frame === null) frame = schedule(flush); },
    flush,
  };
}
