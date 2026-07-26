import fs from "node:fs";
import { repoPath } from "@/lib/paths";

/**
 * Machine-local settings (gitignored, unlike assistant.json). Today this holds
 * only which machine runs Ableton Live; the file is created on first write.
 */
export type StudioSettings = {
  /** Hostname or IP where Ableton Live + AbletonOSC run. Default: this machine. */
  abletonHost: string;
};

const SETTINGS_FILE = "settings.json";
const DEFAULTS: StudioSettings = { abletonHost: "127.0.0.1" };

export function readSettings(): StudioSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(repoPath(SETTINGS_FILE), "utf8")) as Partial<StudioSettings>;
    return {
      abletonHost:
        typeof parsed.abletonHost === "string" && parsed.abletonHost.trim()
          ? parsed.abletonHost.trim()
          : DEFAULTS.abletonHost,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(update: Partial<StudioSettings>): StudioSettings {
  const next = { ...readSettings(), ...update };
  if (typeof next.abletonHost !== "string" || !next.abletonHost.trim()) {
    throw new Error("abletonHost must be a hostname or IP address.");
  }
  next.abletonHost = next.abletonHost.trim();
  fs.writeFileSync(repoPath(SETTINGS_FILE), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
