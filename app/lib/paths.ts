import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const REPO_ROOT = path.resolve(process.cwd(), "..");

function defaultDataRoot() {
  const override = process.env.STUDIO_ASSISTANT_DATA_DIR?.trim();
  if (override) return path.resolve(override);

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Futureproof Studio Assistant");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Futureproof Studio Assistant");
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "futureproof-studio-assistant");
}

/** Student-owned state. It survives replacing, recloning, or updating the code checkout. */
export const DATA_ROOT = defaultDataRoot();

export function repoPath(...segments: string[]) {
  return path.join(REPO_ROOT, ...segments);
}

export function dataPath(...segments: string[]) {
  return path.join(DATA_ROOT, ...segments);
}

export function ensureDataDirectory(...segments: string[]) {
  const directory = dataPath(...segments);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}
