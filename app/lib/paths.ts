import fs from "node:fs";
import path from "node:path";

export const REPO_ROOT = path.resolve(process.cwd(), "..");

import { defaultDataRoot } from "./runtime/config.js";

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
