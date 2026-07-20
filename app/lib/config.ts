import fs from "node:fs";
import { repoPath } from "@/lib/paths";

export type AssistantConfig = {
  name: string;
  accentColor: string;
  tabs: string[];
};

export function readAssistantConfig(): AssistantConfig {
  const contents = fs.readFileSync(repoPath("assistant.json"), "utf8");
  const config = JSON.parse(contents) as AssistantConfig;

  if (
    typeof config.name !== "string" ||
    typeof config.accentColor !== "string" ||
    !Array.isArray(config.tabs)
  ) {
    throw new Error("assistant.json is invalid");
  }

  return config;
}
