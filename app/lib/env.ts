import fs from "node:fs";
import { repoPath } from "@/lib/paths";

const ENV_PATH = repoPath(".env");

// Ported from voice/server.js so the Talk stack reads the same repo-root .env
// the voice relay used. The key never leaves the server.
export function parseEnv(source: string) {
  const values: Record<string, string> = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }

  return values;
}

export function readGeminiApiKey() {
  try {
    return parseEnv(fs.readFileSync(ENV_PATH, "utf8")).GEMINI_API_KEY || "";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return "";
  }
}
