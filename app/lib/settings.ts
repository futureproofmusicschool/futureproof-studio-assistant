import { writeJson } from "./runtime/files.js";
import fs from "node:fs";
import { dataPath, ensureDataDirectory } from "@/lib/paths";

/**
 * Machine-local settings in the external student-data directory: connector
 * host, Ableton machine, and MIDI composer. Created on first write.
 */

/** Which brain the composer seam calls. See lib/composer.ts. */
export type ComposerBackend = "gemini" | "anthropic-api" | "claude-code";

export const COMPOSER_BACKENDS: ComposerBackend[] = ["gemini", "anthropic-api", "claude-code"];

/**
 * Which already-authenticated local agent owns Google connector calls.
 * `auto` prefers a ready Codex connector, then a ready Claude connector. It
 * deliberately never falls through to direct Google OAuth: that mode must be
 * selected explicitly because it has a different credential and privacy
 * boundary.
 */
export type ConnectorHost = "auto" | "codex" | "claude" | "direct-google";

export const CONNECTOR_HOSTS: ConnectorHost[] = ["auto", "codex", "claude", "direct-google"];

export type StudioSettings = {
  /** Hostname or IP where Ableton Live + AbletonOSC run. Default: this machine. */
  abletonHost: string;
  composer: { backend: ComposerBackend };
  connectors: { host: ConnectorHost };
};

const SETTINGS_FILE = "settings.json";
const DEFAULTS: StudioSettings = {
  abletonHost: "127.0.0.1",
  composer: { backend: "gemini" },
  connectors: { host: "auto" },
};

function isBackend(value: unknown): value is ComposerBackend {
  return typeof value === "string" && (COMPOSER_BACKENDS as string[]).includes(value);
}

export function isConnectorHost(value: unknown): value is ConnectorHost {
  return typeof value === "string" && (CONNECTOR_HOSTS as string[]).includes(value);
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
      connectors: {
        host: isConnectorHost(parsed.connectors?.host)
          ? parsed.connectors.host
          : DEFAULTS.connectors.host,
      },
    };
  } catch {
    return {
      abletonHost: DEFAULTS.abletonHost,
      composer: { ...DEFAULTS.composer },
      connectors: { ...DEFAULTS.connectors },
    };
  }
}

export function writeSettings(update: Partial<StudioSettings>): StudioSettings {
  const current = readSettings();
  const next: StudioSettings = {
    abletonHost: update.abletonHost ?? current.abletonHost,
    composer: { ...current.composer, ...(update.composer ?? {}) },
    connectors: { ...current.connectors, ...(update.connectors ?? {}) },
  };

  if (typeof next.abletonHost !== "string" || !next.abletonHost.trim()) {
    throw new Error("abletonHost must be a hostname or IP address.");
  }
  next.abletonHost = next.abletonHost.trim();

  if (!isBackend(next.composer.backend)) {
    throw new Error(`composer.backend must be one of ${COMPOSER_BACKENDS.join(", ")}.`);
  }

  if (!isConnectorHost(next.connectors.host)) {
    throw new Error(`connectors.host must be one of ${CONNECTOR_HOSTS.join(", ")}.`);
  }

  ensureDataDirectory();
  writeJson(dataPath(SETTINGS_FILE), next);
  return next;
}
