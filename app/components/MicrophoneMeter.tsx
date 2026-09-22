"use client";
import { useSyncExternalStore } from "react";
import type { MeterStore } from "@/lib/meter-store";
export function MicrophoneMeter({ meter }: { meter: MeterStore }) {
  const level = useSyncExternalStore(meter.subscribe, meter.getSnapshot, meter.getServerSnapshot);
  return <span className="talk-mic" aria-label={`Microphone level ${Math.round(level * 100)} percent`}>
    <span className="talk-mic-fill" style={{ transform: `scaleX(${Math.max(0.02, level)})` }} />
  </span>;
}
