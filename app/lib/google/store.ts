import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataPath, ensureDataDirectory } from "@/lib/paths";

const GOOGLE_DIR = dataPath("google");
const TOKEN_PATH = path.join(GOOGLE_DIR, "oauth.json");
const PENDING_PATH = path.join(GOOGLE_DIR, "oauth-pending.json");
const PENDING_TTL_MS = 10 * 60_000;

export type StoredGoogleAuthorization = {
  version: 1;
  refreshToken: string;
  scopes: string[];
  email: string | null;
  subject: string | null;
  connectedAt: string;
  updatedAt: string;
};

export type PendingGoogleAuthorization = {
  state: string;
  codeVerifier: string;
  scopes: string[];
  createdAt: string;
};

type PendingFile = { version: 1; attempts: PendingGoogleAuthorization[] };

function secureDirectory() {
  ensureDataDirectory("google");
  try {
    fs.chmodSync(GOOGLE_DIR, 0o700);
  } catch {
    // Windows and some mounted filesystems do not expose Unix permission bits.
  }
}

export function writePrivateGoogleJson(target: string, value: unknown) {
  secureDirectory();
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      fs.chmodSync(temporary, 0o600);
    } catch {
      // See secureDirectory: the containing private directory remains the boundary.
    }
    fs.renameSync(temporary, target);
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // Best effort on platforms without POSIX modes.
    }
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

export function readGoogleAuthorization(): StoredGoogleAuthorization | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Partial<StoredGoogleAuthorization>;
    const scopes = stringArray(value.scopes);
    if (
      value.version !== 1 ||
      typeof value.refreshToken !== "string" ||
      !value.refreshToken ||
      !scopes ||
      (value.email !== null && typeof value.email !== "string") ||
      (value.subject !== null && typeof value.subject !== "string") ||
      typeof value.connectedAt !== "string" ||
      typeof value.updatedAt !== "string"
    ) {
      throw new Error("The saved Google authorization is invalid. Disconnect Google and sign in again.");
    }
    return value as StoredGoogleAuthorization;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      throw new Error("The saved Google authorization is unreadable. Disconnect Google and sign in again.");
    }
    throw error;
  }
}

export function writeGoogleAuthorization(value: StoredGoogleAuthorization) {
  writePrivateGoogleJson(TOKEN_PATH, value);
}

export function updateGoogleRefreshToken(refreshToken: string, expectedRefreshToken: string) {
  const current = readGoogleAuthorization();
  // Compare-and-swap: an old OAuth client can finish a refresh after the user
  // disconnects and connects another account. It may update only the exact
  // authorization record it started from, never whichever account is current.
  if (!current || current.refreshToken !== expectedRefreshToken || !refreshToken || current.refreshToken === refreshToken) {
    return;
  }
  writeGoogleAuthorization({ ...current, refreshToken, updatedAt: new Date().toISOString() });
}

export function clearGoogleAuthorization() {
  try {
    fs.unlinkSync(TOKEN_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function clearPendingGoogleAuthorizations() {
  try {
    fs.unlinkSync(PENDING_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function readPending(): PendingFile {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(PENDING_PATH, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return { version: 1, attempts: [] };
    const attempts = (parsed as Partial<PendingFile>).attempts;
    if (!Array.isArray(attempts)) return { version: 1, attempts: [] };
    return {
      version: 1,
      attempts: attempts.filter(
        (attempt): attempt is PendingGoogleAuthorization =>
          typeof attempt === "object" &&
          attempt !== null &&
          typeof attempt.state === "string" &&
          typeof attempt.codeVerifier === "string" &&
          stringArray(attempt.scopes) !== null &&
          typeof attempt.createdAt === "string",
      ),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
      return { version: 1, attempts: [] };
    }
    throw error;
  }
}

function currentAttempts() {
  const cutoff = Date.now() - PENDING_TTL_MS;
  return readPending().attempts.filter((attempt) => Date.parse(attempt.createdAt) >= cutoff);
}

export function savePendingGoogleAuthorization(attempt: PendingGoogleAuthorization) {
  const attempts = currentAttempts().filter((current) => current.state !== attempt.state);
  writePrivateGoogleJson(PENDING_PATH, { version: 1, attempts: [...attempts, attempt].slice(-5) } satisfies PendingFile);
}

function stateMatches(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

export function consumePendingGoogleAuthorization(state: string) {
  const attempts = currentAttempts();
  const index = attempts.findIndex((attempt) => stateMatches(attempt.state, state));
  if (index === -1) throw new Error("That Google sign-in request expired or was already used. Start again from Settings.");
  const [attempt] = attempts.splice(index, 1);
  if (attempts.length) writePrivateGoogleJson(PENDING_PATH, { version: 1, attempts } satisfies PendingFile);
  else {
    try {
      fs.unlinkSync(PENDING_PATH);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return attempt;
}

export const GOOGLE_TOKEN_PATH = TOKEN_PATH;
