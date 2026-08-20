import "server-only";

import fs from "node:fs";
import path from "node:path";
import { importLegacyContacts, type LegacyContactsImportResult } from "@/lib/contacts";
import { importLegacyDocuments, type LegacyDocumentImportResult } from "@/lib/documents";
import { getGoogleConnectionStatus } from "@/lib/google/auth";
import { googleAccountIdentitiesMatch } from "@/lib/google/auth-logic";
import { readGoogleAuthorization, writePrivateGoogleJson } from "@/lib/google/store";
import { dataPath } from "@/lib/paths";
import { ensureDataDirectory } from "@/lib/paths";
import {
  getGoogleConnectorStatus,
  usesAgentGoogleConnectors,
} from "@/lib/connectors/google-runtime";
import { ensureConnectorWorkspace } from "@/lib/connectors/google-workspace";
import { readConnectorHostState, type AgentConnectorHost } from "@/lib/connectors/state";

const MIGRATION_PATH = dataPath("google", "migration.json");
const CONNECTOR_MIGRATION_PATH = dataPath("connectors", "migration.json");
const LEGACY_CONTACTS_PATH = dataPath("contacts", "contacts.json");
const LEGACY_DOCUMENTS_PATH = dataPath("documents");

type ImportError = { contacts?: string; documents?: string };

export type GoogleMigrationRun = {
  version: 1;
  account: { subject: string | null; email: string | null; provider?: "direct-google" | AgentConnectorHost };
  startedAt: string;
  finishedAt: string;
  complete: boolean;
  contacts: LegacyContactsImportResult | null;
  documents: LegacyDocumentImportResult | null;
  errors: ImportError;
};

let migrationInFlight: { accountKey: string; promise: Promise<GoogleMigrationRun> } | null = null;

function currentMigrationPath() {
  return usesAgentGoogleConnectors() ? CONNECTOR_MIGRATION_PATH : MIGRATION_PATH;
}

function readRun(target = currentMigrationPath()): GoogleMigrationRun | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(target, "utf8"));
    if (typeof parsed !== "object" || parsed === null || (parsed as GoogleMigrationRun).version !== 1) return null;
    return parsed as GoogleMigrationRun;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function writeRun(target: string, run: GoogleMigrationRun) {
  if (target === MIGRATION_PATH) {
    writePrivateGoogleJson(target, run);
    return;
  }
  ensureDataDirectory("connectors");
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

type LegacyInventory = { count: number; error?: string };

function legacyContactInventory(): LegacyInventory {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(LEGACY_CONTACTS_PATH, "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      return { count: 0, error: "The local contacts file does not contain a contacts object." };
    }
    const contacts = (parsed as { contacts?: unknown }).contacts;
    if (!Array.isArray(contacts)) {
      return { count: 0, error: "The local contacts file does not contain a contacts list." };
    }
    return { count: contacts.length };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { count: 0 };
    return {
      count: 0,
      error:
        error instanceof SyntaxError
          ? "The local contacts file is not valid JSON."
          : error instanceof Error
            ? `The local contacts file could not be read: ${error.message}`
            : "The local contacts file could not be read.",
    };
  }
}

function legacyDocumentInventory(): LegacyInventory {
  try {
    return {
      count: fs
        .readdirSync(LEGACY_DOCUMENTS_PATH, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."))
        .length,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { count: 0 };
    return {
      count: 0,
      error:
        error instanceof Error
          ? `The local documents folder could not be read: ${error.message}`
          : "The local documents folder could not be read.",
    };
  }
}

function sameMigrationAccount(
  current: GoogleMigrationRun["account"] | null,
  prior: GoogleMigrationRun["account"] | null | undefined,
) {
  if (!current || !prior) return false;
  if (current.provider === "codex" || current.provider === "claude") {
    const priorIsConnector = prior.provider === "codex" || prior.provider === "claude";
    return Boolean(
      priorIsConnector &&
      current.email &&
      prior.email &&
      current.email.trim().toLowerCase() === prior.email.trim().toLowerCase(),
    );
  }
  return googleAccountIdentitiesMatch(current, prior);
}

async function migrationConnection() {
  if (!usesAgentGoogleConnectors()) {
    const connection = getGoogleConnectionStatus();
    const authorization = connection.connected ? readGoogleAuthorization() : null;
    return {
      connected: connection.connected,
      account: authorization
        ? { subject: authorization.subject, email: authorization.email, provider: "direct-google" as const }
        : null,
    };
  }
  const status = await getGoogleConnectorStatus();
  const host = status.effectiveHost === "codex" || status.effectiveHost === "claude"
    ? status.effectiveHost
    : null;
  const workspace = host ? readConnectorHostState(host).workspace : null;
  return {
    connected: Boolean(host && status.apps.drive.connected),
    account: host
      ? { subject: `connector:${host}`, email: workspace?.profileEmail ?? null, provider: host }
      : null,
  };
}

export async function getGoogleMigrationStatus() {
  const connection = await migrationConnection();
  const lastRun = readRun();
  const contacts = legacyContactInventory();
  const documents = legacyDocumentInventory();
  const sameAccount = sameMigrationAccount(connection.account, lastRun?.account);
  const currentRun = sameAccount ? lastRun : null;
  return {
    connected: connection.connected,
    accountEmail: connection.account?.email ?? null,
    legacy: {
      contacts: contacts.count,
      documents: documents.count,
      errors: {
        ...(contacts.error ? { contacts: contacts.error } : {}),
        ...(documents.error ? { documents: documents.error } : {}),
      },
    },
    complete: currentRun?.complete ?? false,
    completedAt: currentRun?.complete ? currentRun.finishedAt : null,
    lastRun: currentRun,
  };
}

/**
 * Explicit, restart-safe import. Each provider has its own idempotency marker,
 * and the local originals are deliberately neither changed nor removed.
 */
async function runLegacyGoogleImport(
  account: GoogleMigrationRun["account"],
  prior: GoogleMigrationRun | null,
  target: string,
): Promise<GoogleMigrationRun> {
  const startedAt = new Date().toISOString();
  // Preserve a provider that already completed successfully. Retrying the
  // other provider must not resurrect a contact or Doc the artist deliberately
  // removed after its successful import.
  let contacts: LegacyContactsImportResult | null =
    prior?.contacts && !prior.errors.contacts ? prior.contacts : null;
  let documents: LegacyDocumentImportResult | null =
    prior?.documents && !prior.errors.documents ? prior.documents : null;
  const errors: ImportError = {};

  // Run independently: one provider being unavailable must not hide a useful
  // result from the other, and a later retry safely skips completed items.
  const [contactsResult, documentsResult] = await Promise.allSettled([
    contacts ? Promise.resolve(contacts) : importLegacyContacts(),
    documents ? Promise.resolve(documents) : importLegacyDocuments(prior?.documents),
  ]);

  if (contactsResult.status === "fulfilled") contacts = contactsResult.value;
  else {
    errors.contacts =
      contactsResult.reason instanceof Error ? contactsResult.reason.message : "Contacts could not be imported.";
  }

  if (documentsResult.status === "fulfilled") documents = documentsResult.value;
  else {
    errors.documents =
      documentsResult.reason instanceof Error ? documentsResult.reason.message : "Documents could not be imported.";
  }

  if (documents?.failed.length) {
    errors.documents = `${documents.failed.length} document${documents.failed.length === 1 ? "" : "s"} could not be imported.`;
  }

  const run: GoogleMigrationRun = {
    version: 1,
    account,
    startedAt,
    finishedAt: new Date().toISOString(),
    complete: Object.keys(errors).length === 0,
    contacts,
    documents,
    errors,
  };
  writeRun(target, run);
  return run;
}

export async function importLegacyGoogleData(): Promise<GoogleMigrationRun> {
  let account: GoogleMigrationRun["account"];
  if (usesAgentGoogleConnectors()) {
    const { host, workspace } = await ensureConnectorWorkspace();
    account = { subject: `connector:${host}`, email: workspace.profileEmail, provider: host };
  } else {
    const connection = getGoogleConnectionStatus();
    const authorization = connection.connected ? readGoogleAuthorization() : null;
    if (!connection.connected || !authorization) {
      throw new Error("Connect a Google account before importing local data.");
    }
    account = {
      subject: authorization.subject,
      email: authorization.email,
      provider: "direct-google",
    };
  }
  const accountKey = `${account.provider}:${account.subject || account.email || "unknown"}`;
  if (!accountKey) throw new Error("Google did not identify the connected account. Reconnect it before importing.");

  if (migrationInFlight) {
    if (migrationInFlight.accountKey !== accountKey) {
      throw new Error("A local-data import is already running for another Google account.");
    }
    return migrationInFlight.promise;
  }

  const target = currentMigrationPath();
  const prior = readRun(target);
  const sameAccountPrior = sameMigrationAccount(account, prior?.account) ? prior : null;
  if (sameAccountPrior?.complete) return sameAccountPrior;

  const promise = runLegacyGoogleImport(account, sameAccountPrior, target);
  migrationInFlight = { accountKey, promise };
  try {
    return await promise;
  } finally {
    if (migrationInFlight?.promise === promise) migrationInFlight = null;
  }
}

export const GOOGLE_MIGRATION_PATH = MIGRATION_PATH;
export const CONNECTOR_GOOGLE_MIGRATION_PATH = CONNECTOR_MIGRATION_PATH;
