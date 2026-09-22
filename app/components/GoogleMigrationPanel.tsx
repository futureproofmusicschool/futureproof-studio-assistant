"use client";
import { clientFetch } from "@/lib/client-requests";

import { useCallback, useEffect, useState } from "react";

type ImportRun = {
  complete: boolean;
  finishedAt: string;
  contacts: { imported: number; matched: number; created: number; skipped: number } | null;
  documents: {
    imported: unknown[];
    skipped: unknown[];
    failed: { legacySlug: string; error: string }[];
  } | null;
  errors: { contacts?: string; documents?: string };
};

type MigrationStatus = {
  connected: boolean;
  accountEmail: string | null;
  legacy: {
    contacts: number;
    documents: number;
    errors: { contacts?: string; documents?: string };
  };
  complete: boolean;
  completedAt: string | null;
  lastRun: ImportRun | null;
  error?: string;
};

type ConnectorStatus = {
  selectedHost: "auto" | "codex" | "claude" | "direct-google";
  apps: {
    drive: { available: boolean; connected: boolean };
  };
  message?: string;
};

async function responseBody(response: Response) {
  const body = (await response.json()) as MigrationStatus & { error?: string };
  if (!response.ok && response.status !== 207) {
    throw new Error(body.error || `Request failed with status ${response.status}.`);
  }
  return body;
}

export function GoogleMigrationPanel() {
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  const [directMode, setDirectMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [migrationResponse, connectorResponse] = await Promise.all([
        clientFetch("/api/google/migration", { cache: "no-store" }),
        clientFetch("/api/connectors/status", { cache: "no-store" }),
      ]);
      const next = await responseBody(migrationResponse);
      setStatus(next);
      const connector = (await connectorResponse.json()) as ConnectorStatus & { error?: string };
      if (!connectorResponse.ok) {
        throw new Error(connector.error || `Connector check failed with status ${connectorResponse.status}.`);
      }
      setDriveConnected(Boolean(connector.apps.drive.connected));
      setDirectMode(connector.selectedHost === "direct-google");
      setError(null);
    } catch (caught) {
      setDriveConnected(false);
      setError(caught instanceof Error ? caught.message : "Could not inspect local data.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  async function runImport() {
    if (!driveConnected) return;
    setBusy(true);
    setError(null);
    try {
      const response = await clientFetch("/api/google/migration", { method: "POST" });
      const next = await responseBody(response);
      setStatus(next);
      setConfirming(false);
      if (!next.lastRun?.complete) setError("The import is incomplete. Review the provider error below, then retry.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not import local data.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <p className="api-key-note">Checking for local contacts and documents…</p>;

  const total = status.legacy.contacts + status.legacy.documents;
  const hasInventoryError = Boolean(status.legacy.errors.contacts || status.legacy.errors.documents);
  const run = status.lastRun;
  const importedContacts = run?.contacts?.imported ?? 0;
  const importedDocuments = run?.documents?.imported.length ?? 0;
  const skipped = (run?.contacts?.skipped ?? 0) + (run?.documents?.skipped.length ?? 0);
  const failedDocuments = run?.documents?.failed ?? [];
  const visibleFailedDocuments = failedDocuments.slice(0, 5);

  return (
    <div className="composer-panel google-migration-panel">
      <div className="composer-panel-summary">
        <div>
          <strong>One-time local import</strong>
          <p className="api-key-note">
            Found {status.legacy.contacts} local contact{status.legacy.contacts === 1 ? "" : "s"} and{" "}
            {status.legacy.documents} markdown document{status.legacy.documents === 1 ? "" : "s"}.
          </p>
        </div>
        {!status.complete && (total > 0 || hasInventoryError) && !confirming ? (
          <button disabled={!driveConnected || busy} onClick={() => setConfirming(true)} type="button">
            Import to Google
          </button>
        ) : null}
      </div>

      {error ? <p className="settings-error" role="alert">{error}</p> : null}
      {status.legacy.errors.contacts ? (
        <p className="settings-error" role="alert">Contacts: {status.legacy.errors.contacts}</p>
      ) : null}
      {status.legacy.errors.documents ? (
        <p className="settings-error" role="alert">Documents: {status.legacy.errors.documents}</p>
      ) : null}

      {!driveConnected ? (
        <p className="api-key-note">Connect Google Drive above before importing. Nothing local will move automatically.</p>
      ) : total === 0 && !hasInventoryError ? (
        <p className="api-key-note">There is no legacy local data to import.</p>
      ) : status.complete ? (
        <p className="api-key-note">
          Import complete{status.completedAt ? ` on ${new Date(status.completedAt).toLocaleString()}` : ""}. Imported{" "}
          {importedContacts} contact{importedContacts === 1 ? "" : "s"} and {importedDocuments} document
          {importedDocuments === 1 ? "" : "s"}{skipped ? `; ${skipped} already existed` : ""}. Local originals were kept.
        </p>
      ) : null}

      {confirming ? (
        <div className="ableton-installer-confirm" data-open="true">
          <div>
            <p>
              {directMode
                ? "Copy these contacts into Google Contacts plus the managed outreach Sheet, and copy these markdown files into native Google Docs? "
                : "Copy these contacts into the managed Sheet's Contacts and History tabs, and copy these markdown files into native Google Docs? "}
              Existing local files will remain untouched. Retrying is safe.
            </p>
            <div>
              <button disabled={busy} onClick={() => void runImport()} type="button">
                {busy ? "Importing…" : "Yes, import"}
              </button>
              <button disabled={busy} onClick={() => setConfirming(false)} type="button">Cancel</button>
            </div>
          </div>
        </div>
      ) : null}

      {run && !run.complete ? (
        <div className="composer-panel-body">
          {run.errors.contacts ? <p className="settings-error">Contacts: {run.errors.contacts}</p> : null}
          {run.errors.documents ? <p className="settings-error">Documents: {run.errors.documents}</p> : null}
          {visibleFailedDocuments.length ? (
            <div className="api-key-note">
              <p>Documents needing attention:</p>
              <ul>
                {visibleFailedDocuments.map((failed, index) => (
                  <li key={`${failed.legacySlug}-${index}`}>
                    <strong>{failed.legacySlug}</strong>: {failed.error}
                  </li>
                ))}
              </ul>
              {failedDocuments.length > visibleFailedDocuments.length ? (
                <p>And {failedDocuments.length - visibleFailedDocuments.length} more.</p>
              ) : null}
            </div>
          ) : null}
          <button disabled={!driveConnected || busy} onClick={() => void runImport()} type="button">
            {busy ? "Retrying…" : "Retry incomplete import"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
