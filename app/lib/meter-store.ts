export function createMeterStore() {
  let level = 0;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => level,
    getServerSnapshot: () => 0,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(value: number) {
      const next = Math.round(value * 100) / 100;
      if (next === level) return;
      level = next;
      listeners.forEach((listener) => listener());
    },
  };
}
export type MeterStore = ReturnType<typeof createMeterStore>;
