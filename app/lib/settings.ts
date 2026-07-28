import fs from "node:fs";
import { dataPath, ensureDataDirectory } from "@/lib/paths";

/**
 * Machine-local settings in the external student-data directory: which machine
 * runs Ableton Live, and which model writes MIDI. The file is created on first write.
 */

/** Which brain the composer seam calls. See lib/composer.ts. */
export type ComposerBackend = "gemini" | "anthropic-api" | "claude-code";

export const COMPOSER_BACKENDS: ComposerBackend[] = ["gemini", "anthropic-api", "claude-code"];

export type StudioSettings = {
  /** Hostname or IP where Ableton Live + AbletonOSC run. Default: this machine. */
  abletonHost: string;
  composer: { backend: ComposerBackend };
};

const SETTINGS_FILE = "settings.json";
const DEFAULTS: StudioSettings = { abletonHost: "127.0.0.1", composer: { backend: "gemini" } };

function isBackend(value: unknown): value is ComposerBackend {
  return typeof value === "string" && (COMPOSER_BACKENDS as string[]).includes(value);
}

export function readSettings(): StudioSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataPath(SETTINGS_FILE), "utf8")) as Partial<StudioSettings>;
    return {
      abletonHost:
        typeof parsed.abletonHost === "string" && parsed.abletonHost.trim()
          ? parsed.abletonHost.trim()
          : DEFAULTS.abletonHost,
      composer: {
        backend: isBackend(parsed.composer?.backend) ? parsed.composer.backend : DEFAULTS.composer.backend,
      },
    };
  } catch {
    return { abletonHost: DEFAULTS.abletonHost, composer: { ...DEFAULTS.composer } };
  }
}

export function writeSettings(update: Partial<StudioSettings>): StudioSettings {
  const current = readSettings();
  const next: StudioSettings = {
    abletonHost: update.abletonHost ?? current.abletonHost,
    composer: { ...current.composer, ...(update.composer ?? {}) },
  };

  if (typeof next.abletonHost !== "string" || !next.abletonHost.trim()) {
    throw new Error("abletonHost must be a hostname or IP address.");
  }
  next.abletonHost = next.abletonHost.trim();

  if (!isBackend(next.composer.backend)) {
    throw new Error(`composer.backend must be one of ${COMPOSER_BACKENDS.join(", ")}.`);
  }

  ensureDataDirectory();
  fs.writeFileSync(dataPath(SETTINGS_FILE), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
