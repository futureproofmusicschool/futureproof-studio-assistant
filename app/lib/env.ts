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

function readEnvValue(name: string) {
  try {
    return parseEnv(fs.readFileSync(ENV_PATH, "utf8"))[name] || "";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return "";
  }
}

/**
 * Save one key into the repo-root .env (gitignored), replacing any existing
 * line for it. Called from the app's setup screen so a new user never has to
 * open a dotfile. Keys are written, never echoed back.
 */
function writeEnvValue(name: string, value: string) {
  const clean = value.trim();
  if (!clean || /\s/.test(clean)) throw new Error("That doesn't look like an API key.");

  let source = "";
  try {
    source = fs.readFileSync(ENV_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const pattern = new RegExp(`^(?:export\\s+)?${name}\\s*=`);
  const lines = source.split(/\r?\n/).filter((line) => !pattern.test(line));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  lines.push(`${name}=${clean}`);
  fs.writeFileSync(ENV_PATH, `${lines.join("\n")}\n`);
}

export function readGeminiApiKey() {
  return readEnvValue("GEMINI_API_KEY");
}

export function writeGeminiApiKey(key: string) {
  writeEnvValue("GEMINI_API_KEY", key);
}

/** Only needed for the anthropic-api composer backend; never the student default. */
export function readAnthropicApiKey() {
  return readEnvValue("ANTHROPIC_API_KEY");
}

export function writeAnthropicApiKey(key: string) {
  writeEnvValue("ANTHROPIC_API_KEY", key);
}
