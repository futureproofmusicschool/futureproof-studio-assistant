import fs from "node:fs";
import { repoPath } from "@/lib/paths";

export type AssistantConfig = {
  name: string;
  accentColor: string;
  chatProvider: ChatProvider;
  tabs: string[];
};

export type ChatProvider = "claude" | "codex";

export function isChatProvider(value: unknown): value is ChatProvider {
  return value === "claude" || value === "codex";
}

export function readAssistantConfig(): AssistantConfig {
  const contents = fs.readFileSync(repoPath("assistant.json"), "utf8");
  const config = JSON.parse(contents) as Partial<AssistantConfig>;

  if (
    typeof config.name !== "string" ||
    typeof config.accentColor !== "string" ||
    (config.chatProvider !== undefined && !isChatProvider(config.chatProvider)) ||
    !Array.isArray(config.tabs)
  ) {
    throw new Error("assistant.json is invalid");
  }

  return {
    name: config.name,
    accentColor: config.accentColor,
    chatProvider: config.chatProvider ?? "claude",
    tabs: config.tabs,
  };
}
