import fs from "node:fs";
import { dataPath, ensureDataDirectory, repoPath } from "@/lib/paths";

export type AssistantConfig = {
  name: string;
  /** What the assistant calls the person using it. Also the transcript speaker label. */
  userName: string;
  accentColor: string;
  tabs: string[];
};

export function readAssistantConfig(): AssistantConfig {
  let contents: string;
  try {
    contents = fs.readFileSync(dataPath("assistant.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    contents = fs.readFileSync(repoPath("examples", "assistant.json"), "utf8");
  }
  const config = JSON.parse(contents) as AssistantConfig;

  if (
    typeof config.name !== "string" ||
    typeof config.accentColor !== "string" ||
    !Array.isArray(config.tabs)
  ) {
    throw new Error("assistant.json is invalid");
  }

  return { ...config, userName: typeof config.userName === "string" && config.userName ? config.userName : "You" };
}

/**
 * Rename the assistant (or the person it is talking to) from the Settings tab.
 * Only these two fields are editable in the UI; tabs and accent colour stay in
 * the file for people who want to hand-edit them.
 */
export function writeAssistantConfig(update: { name?: string; userName?: string }): AssistantConfig {
  const current = readAssistantConfig();
  const next: AssistantConfig = {
    ...current,
    ...(typeof update.name === "string" ? { name: update.name.trim() } : {}),
    ...(typeof update.userName === "string" ? { userName: update.userName.trim() } : {}),
  };

  if (!next.name) throw new Error("The assistant needs a name.");
  if (!next.userName) throw new Error("Your name cannot be empty.");

  ensureDataDirectory();
  fs.writeFileSync(dataPath("assistant.json"), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
