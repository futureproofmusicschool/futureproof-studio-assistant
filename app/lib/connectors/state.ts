import "server-only";

import fs from "node:fs";
import path from "node:path";
import { dataPath, ensureDataDirectory } from "@/lib/paths";

export type AgentConnectorHost = "codex" | "claude";

export type ConnectorWorkspaceState = {
  folderId: string;
  folderUrl: string;
  spreadsheetId: string | null;
  spreadsheetUrl: string | null;
  profileEmail: string | null;
  updatedAt: string;
};

export type ConnectorDocumentRecord = {
  id: string;
  source: "assistant" | "you" | "deep-research";
  operationId: string | null;
  payloadHash: string | null;
  state?: "pending" | "complete" | "ambiguous";
  createdAt: string;
  updatedAt: string;
};

export type ConnectorDraftIntent = {
  operationId: string;
  payloadHash: string;
  state: "pending" | "complete" | "ambiguous";
  createdAt: string;
  updatedAt: string;
  draftId?: string;
  messageId?: string | null;
  threadId?: string | null;
  webViewLink?: string;
};

export type ConnectorHostState = {
  workspace: ConnectorWorkspaceState | null;
  documents: Record<string, ConnectorDocumentRecord>;
  documentOperations: Record<string, string>;
  draftIntents: Record<string, ConnectorDraftIntent>;
};

export type ConnectorState = {
  version: 1;
  hosts: Partial<Record<AgentConnectorHost, ConnectorHostState>>;
};

const STATE_PATH = dataPath("connectors", "state.json");

function emptyHostState(): ConnectorHostState {
  return { workspace: null, documents: {}, documentOperations: {}, draftIntents: {} };
}

function emptyState(): ConnectorState {
  return { version: 1, hosts: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validHostState(value: unknown): value is ConnectorHostState {
  if (!isRecord(value)) return false;
  return (
    (value.workspace === null || isRecord(value.workspace)) &&
    isRecord(value.documents) &&
    isRecord(value.documentOperations) &&
    isRecord(value.draftIntents)
  );
}

export function readConnectorState(): ConnectorState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    if (error instanceof SyntaxError) {
      throw new Error("The local connector receipt file is unreadable. It was left untouched to avoid duplicate Google writes.");
    }
    throw error;
  }

  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.hosts)) {
    throw new Error("The local connector receipt file has an unsupported format. It was left untouched.");
  }
  for (const [host, state] of Object.entries(parsed.hosts)) {
    if ((host !== "codex" && host !== "claude") || !validHostState(state)) {
      throw new Error("The local connector receipt file is invalid. It was left untouched.");
    }
  }
  return parsed as ConnectorState;
}

function writeConnectorState(state: ConnectorState) {
  ensureDataDirectory("connectors");
  const temporary = `${STATE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, STATE_PATH);
    fs.chmodSync(STATE_PATH, 0o600);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Best-effort cleanup. The original state file remains authoritative.
    }
    throw error;
  }
}

export function readConnectorHostState(host: AgentConnectorHost): ConnectorHostState {
  const state = readConnectorState().hosts[host];
  return state
    ? {
        workspace: state.workspace ? { ...state.workspace } : null,
        documents: { ...state.documents },
        documentOperations: { ...state.documentOperations },
        draftIntents: { ...state.draftIntents },
      }
    : emptyHostState();
}

export function updateConnectorHostState(
  host: AgentConnectorHost,
  update: (current: ConnectorHostState) => ConnectorHostState,
) {
  const state = readConnectorState();
  const current = state.hosts[host] ?? emptyHostState();
  const next = update({
    workspace: current.workspace ? { ...current.workspace } : null,
    documents: { ...current.documents },
    documentOperations: { ...current.documentOperations },
    draftIntents: { ...current.draftIntents },
  });
  state.hosts[host] = next;
  writeConnectorState(state);
  return next;
}

export function clearConnectorWorkspace(host: AgentConnectorHost) {
  return updateConnectorHostState(host, (current) => ({ ...current, workspace: null }));
}

export const CONNECTOR_STATE_PATH = path.resolve(STATE_PATH);
