"use client";
import { createContext, useContext, type ReactNode } from "react";
import { useGeminiLive } from "@/hooks/useGeminiLive";

const LiveContext = createContext<ReturnType<typeof useGeminiLive> | null>(null);
/** The call survives route navigation; the provider owns its resources. */
export function LiveSessionProvider({ assistantName, userName, children }: { assistantName: string; userName: string; children: ReactNode }) {
  const live = useGeminiLive({ assistantLabel: assistantName, userLabel: userName });
  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}
export function useLiveSession() {
  const live = useContext(LiveContext);
  if (!live) throw new Error("Live session provider is missing.");
  return live;
}
