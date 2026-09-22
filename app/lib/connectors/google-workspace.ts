import "server-only";

import {
  firstArray,
  firstString,
  isRecord,
  unwrapConnectorResult,
  walkRecords,
  type JsonRecord,
} from "@/lib/connectors/result";
import {
  readConnectorHostState,
  updateConnectorHostState,
  type AgentConnectorHost,
  type ConnectorWorkspaceState,
} from "@/lib/connectors/state";
import {
  callGoogleConnectorTool,
  connectorAccountVersion,
  requireAgentConnectorHost,
} from "@/lib/connectors/google-runtime";
import {
  CONNECTOR_CONTACT_HEADERS,
  CONNECTOR_OUTREACH_SPREADSHEET_NAME,
  OUTREACH_SPREADSHEET_NAME,
  classifyOutreachSpreadsheet,
  connectorOutreachSpreadsheetName,
  type OutreachSchema,
} from "@/lib/connectors/google-workspace-logic";

export {
  CONNECTOR_CONTACT_HEADERS,
  OUTREACH_SPREADSHEET_NAME,
} from "@/lib/connectors/google-workspace-logic";

export const STUDIO_FOLDER_NAME = "Futureproof Studio Assistant";

export const CONNECTOR_HISTORY_HEADERS = [
  "operationId",
  "contactId",
  "date",
  "channel",
  "summary",
  "createdAt",
] as const;
export const CONNECTOR_CATEGORY_HEADERS = ["id", "name", "position"] as const;
export const CONNECTOR_OPERATION_HEADERS = [
  "operationId",
  "kind",
  "targetId",
  "payloadHash",
  "status",
  "providerId",
  "createdAt",
  "completedAt",
] as const;

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const SHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const DEFAULT_CATEGORIES = [
  ["collaborators", "Collaborators", 0],
  ["leads", "Leads", 1],
  ["label", "Labels", 2],
] as const;

let workspaceInFlight: Promise<{ host: AgentConnectorHost; workspace: ConnectorWorkspaceState }> | null = null;
let verifiedWorkspace: {
  host: AgentConnectorHost;
  workspace: ConnectorWorkspaceState;
  expiresAt: number;
  accountVersion: number;
} | null = null;
const WORKSPACE_CACHE_MS = 5 * 60_000;

function stringField(record: JsonRecord, keys: readonly string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function extractGoogleId(value: string | null) {
  if (!value) return null;
  const match = value.match(/\/(?:folders|d)\/([A-Za-z0-9_-]+)/) ?? value.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (match?.[1]) return match[1];
  return /^[A-Za-z0-9_-]{8,}$/.test(value) ? value : null;
}

export type ConnectorDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  createdTime: string | null;
  modifiedTime: string | null;
  parents: string[];
};

export function connectorDriveFiles(value: unknown): ConnectorDriveFile[] {
  const files = new Map<string, ConnectorDriveFile>();
  for (const record of walkRecords(value)) {
    const rawId = stringField(record, ["id", "fileId", "file_id"]);
    const url = stringField(record, ["webViewLink", "web_view_link", "url", "uri"]);
    const id = extractGoogleId(rawId) ?? extractGoogleId(url);
    const name = stringField(record, ["name", "title"]);
    const mimeType = stringField(record, ["mimeType", "mime_type"]);
    if (!id || !name || !mimeType) continue;
    const parentsValue = record.parents ?? record.parent_ids ?? record.parentIds;
    const parents = Array.isArray(parentsValue)
      ? parentsValue.filter((parent): parent is string => typeof parent === "string")
      : [];
    files.set(id, {
      id,
      name,
      mimeType,
      webViewLink: url,
      createdTime: stringField(record, ["createdTime", "created_time", "createdAt", "created_at"]),
      modifiedTime: stringField(record, ["modifiedTime", "modified_time", "updatedAt", "updated_at"]),
      parents,
    });
  }
  return Array.from(files.values());
}

export function connectorCreatedFile(value: unknown, mimeType: string, fallbackName: string) {
  const exact = connectorDriveFiles(value).find((file) => file.mimeType === mimeType);
  if (exact) return exact;
  const unwrapped = unwrapConnectorResult(value);
  const id = firstString(unwrapped, ["id", "fileId", "file_id"])
    ?? extractGoogleId(firstString(unwrapped, ["webViewLink", "web_view_link", "url", "uri"]));
  if (!id) throw new Error(`Google Drive created ${fallbackName}, but the connector did not return its file id.`);
  return {
    id,
    name: firstString(unwrapped, ["name", "title"]) ?? fallbackName,
    mimeType,
    webViewLink: firstString(unwrapped, ["webViewLink", "web_view_link", "url", "uri"]),
    createdTime: firstString(unwrapped, ["createdTime", "created_time", "createdAt", "created_at"]),
    modifiedTime: firstString(unwrapped, ["modifiedTime", "modified_time", "updatedAt", "updated_at"]),
    parents: [],
  } satisfies ConnectorDriveFile;
}

function folderUrl(id: string) {
  return `https://drive.google.com/drive/folders/${id}`;
}

export function spreadsheetUrl(id: string) {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

export function documentUrl(id: string) {
  return `https://docs.google.com/document/d/${id}/edit`;
}

async function listFolder(host: AgentConnectorHost, url: string) {
  const result = await callGoogleConnectorTool(host, "drive", "google_drive_list_folder", {
    url,
    top_k: 1000,
  });
  return connectorDriveFiles(result);
}

async function moveIntoFolder(host: AgentConnectorHost, file: ConnectorDriveFile, destinationId: string) {
  let parents = file.parents;
  if (!parents.length) {
    try {
      const metadata = await callGoogleConnectorTool(
        host,
        "drive",
        "google_drive_get_file_metadata",
        { fileId: file.id, fields: "id,name,mimeType,webViewLink,createdTime,modifiedTime,parents" },
      );
      parents = connectorDriveFiles(metadata)[0]?.parents ?? [];
    } catch {
      // Adding a parent remains safe when an older connector omits parent metadata.
    }
  }
  if (parents.includes(destinationId)) return;
  await callGoogleConnectorTool(host, "drive", "google_drive_update_file", {
    fileId: file.id,
    addParents: destinationId,
    ...(parents.length ? { removeParents: parents.join(",") } : {}),
  });
}

type SheetProperties = { sheetId: number; title: string };

export function connectorSheetProperties(value: unknown): SheetProperties[] {
  const sheets = new Map<number, SheetProperties>();
  for (const record of walkRecords(value)) {
    const sheetId = typeof record.sheetId === "number" ? record.sheetId : null;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (sheetId !== null && title) sheets.set(sheetId, { sheetId, title });
  }
  return Array.from(sheets.values());
}

function cell(value: unknown) {
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
  if (typeof value === "number" && Number.isFinite(value)) return { userEnteredValue: { numberValue: value } };
  return { userEnteredValue: { stringValue: value == null ? "" : String(value) } };
}

export function sheetRow(values: readonly unknown[]) {
  return { values: values.map(cell) };
}

export async function connectorSpreadsheetValues(
  host: AgentConnectorHost,
  spreadsheetId: string,
  sheetName: string,
  range: string,
): Promise<unknown[][]> {
  const result = await callGoogleConnectorTool(
    host,
    "drive",
    "google_drive_get_spreadsheet_range",
    {
      spreadsheet_id: spreadsheetId,
      sheet_name: sheetName,
      range,
      value_render_option: "UNFORMATTED_VALUE",
    },
  );
  const values = firstArray(result, ["values", "rows", "data"]);
  if (!values) return [];
  return values.filter(Array.isArray) as unknown[][];
}

export async function connectorSpreadsheetBatchUpdate(
  host: AgentConnectorHost,
  spreadsheetId: string,
  requests: Array<Record<string, unknown>>,
) {
  if (!requests.length) return null;
  return callGoogleConnectorTool(host, "drive", "google_drive_batch_update_spreadsheet", {
    spreadsheet_id: spreadsheetId,
    requests,
  });
}

async function initializeOutreachSpreadsheet(host: AgentConnectorHost, spreadsheetId: string) {
  const metadata = await callGoogleConnectorTool(
    host,
    "drive",
    "google_drive_get_spreadsheet_metadata",
    { spreadsheet_id: spreadsheetId },
  );
  let sheets = connectorSheetProperties(metadata);
  if (!sheets.length) throw new Error("Google Sheets did not return the new spreadsheet's tabs.");
  const required = ["Contacts", "History", "Categories", "Operations"];
  const requests: Array<Record<string, unknown>> = [];
  if (!sheets.some((sheet) => sheet.title === "Contacts")) {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: sheets[0].sheetId, title: "Contacts", gridProperties: { frozenRowCount: 1 } },
        fields: "title,gridProperties.frozenRowCount",
      },
    });
    sheets = sheets.map((sheet, index) => index === 0 ? { ...sheet, title: "Contacts" } : sheet);
  }
  for (const title of required) {
    if (!sheets.some((sheet) => sheet.title === title)) {
      requests.push({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } });
    }
  }
  await connectorSpreadsheetBatchUpdate(host, spreadsheetId, requests);

  const refreshed = await callGoogleConnectorTool(
    host,
    "drive",
    "google_drive_get_spreadsheet_metadata",
    { spreadsheet_id: spreadsheetId },
  );
  const byTitle = new Map(connectorSheetProperties(refreshed).map((sheet) => [sheet.title, sheet.sheetId]));
  for (const title of required) {
    if (!byTitle.has(title)) throw new Error(`The managed outreach spreadsheet is missing its ${title} tab.`);
  }

  const headers = {
    Contacts: CONNECTOR_CONTACT_HEADERS,
    History: CONNECTOR_HISTORY_HEADERS,
    Categories: CONNECTOR_CATEGORY_HEADERS,
    Operations: CONNECTOR_OPERATION_HEADERS,
  } as const;
  const headerRequests: Array<Record<string, unknown>> = [];
  for (const title of required) {
    const existing = await connectorSpreadsheetValues(host, spreadsheetId, title, "A1:Z2");
    const expectedHeaders = headers[title as keyof typeof headers];
    if (existing[0]?.length) {
      const matches = (candidate: readonly string[]) =>
        existing[0].length >= candidate.length &&
        existing[0].slice(0, candidate.length).every((value, index) => String(value) === candidate[index]);
      if (!matches(expectedHeaders)) {
        throw new Error(
          `The managed outreach spreadsheet's ${title} header was changed. Restore the original columns before Studio Assistant writes to it.`,
        );
      }
      continue;
    }
    const rows = [sheetRow(expectedHeaders)];
    if (title === "Categories") rows.push(...DEFAULT_CATEGORIES.map((row) => sheetRow(row)));
    headerRequests.push({
      updateCells: {
        start: { sheetId: byTitle.get(title), rowIndex: 0, columnIndex: 0 },
        rows,
        fields: "userEnteredValue",
      },
    });
  }
  await connectorSpreadsheetBatchUpdate(host, spreadsheetId, headerRequests);
}

async function outreachSchema(host: AgentConnectorHost, spreadsheetId: string): Promise<OutreachSchema> {
  const metadata = await callGoogleConnectorTool(
    host,
    "drive",
    "google_drive_get_spreadsheet_metadata",
    { spreadsheet_id: spreadsheetId },
  );
  const hasContactsSheet = connectorSheetProperties(metadata).some((sheet) => sheet.title === "Contacts");
  // A newly created spreadsheet still has its default Sheet1 tab. It has no
  // Contacts range yet, so initialization should resume on the same file.
  if (!hasContactsSheet) return classifyOutreachSpreadsheet({ hasContactsSheet: false });
  const rows = await connectorSpreadsheetValues(host, spreadsheetId, "Contacts", "A1:L1");
  return classifyOutreachSpreadsheet({ hasContactsSheet: true, contactHeader: rows[0] ?? [] });
}

async function createWorkspace(): Promise<{ host: AgentConnectorHost; workspace: ConnectorWorkspaceState }> {
  const host = await requireAgentConnectorHost("drive");
  const profile = await callGoogleConnectorTool(host, "drive", "google_drive_get_profile", {});
  const profileEmail = firstString(profile, ["email", "emailAddress", "email_address", "userEmail"]);
  if (!profileEmail) {
    throw new Error("Google Drive did not identify its connected account. Reconnect Drive before continuing.");
  }
  const previous = readConnectorHostState(host).workspace;
  const root = await listFolder(host, "root");
  let folder = previous
    ? root.find((file) => file.id === previous.folderId && file.mimeType === FOLDER_MIME_TYPE)
    : undefined;
  folder ??= root.find((file) => file.name === STUDIO_FOLDER_NAME && file.mimeType === FOLDER_MIME_TYPE);
  if (!folder) {
    const created = await callGoogleConnectorTool(host, "drive", "google_drive_create_folder", {
      name: STUDIO_FOLDER_NAME,
      parent_folder: "root",
    });
    folder = connectorCreatedFile(created, FOLDER_MIME_TYPE, STUDIO_FOLDER_NAME);
  }

  const children = await listFolder(host, folderUrl(folder.id));
  let spreadsheet = previous?.spreadsheetId
    ? children.find((file) => file.id === previous.spreadsheetId && file.mimeType === SHEET_MIME_TYPE)
    : undefined;
  const primarySpreadsheet = children.find(
    (file) => file.name === OUTREACH_SPREADSHEET_NAME && file.mimeType === SHEET_MIME_TYPE,
  );
  spreadsheet ??= primarySpreadsheet;
  // A prior create can commit in My Drive while its connector response is
  // lost, before Studio Assistant learns the id and moves it. Recover that
  // exact distinctive title instead of creating a sibling duplicate.
  spreadsheet ??= root.find(
    (file) => file.name === OUTREACH_SPREADSHEET_NAME && file.mimeType === SHEET_MIME_TYPE,
  );
  let spreadsheetTitle = OUTREACH_SPREADSHEET_NAME;
  if (spreadsheet && (await outreachSchema(host, spreadsheet.id)) === "direct") {
    // Advanced direct OAuth uses the same human-facing title but a different
    // People-linked Contacts schema. Never rewrite that Sheet: keep each mode
    // reversible and create a connector-specific sibling only when both modes
    // have been used with the same account.
    spreadsheet = children.find(
      (file) => file.name === CONNECTOR_OUTREACH_SPREADSHEET_NAME && file.mimeType === SHEET_MIME_TYPE,
    ) ?? root.find(
      (file) => file.name === CONNECTOR_OUTREACH_SPREADSHEET_NAME && file.mimeType === SHEET_MIME_TYPE,
    );
    spreadsheetTitle = connectorOutreachSpreadsheetName("direct");
  }
  if (!spreadsheet) {
    const created = await callGoogleConnectorTool(host, "drive", "google_drive_create_file", {
      mime_type: SHEET_MIME_TYPE,
      title: spreadsheetTitle,
    });
    spreadsheet = connectorCreatedFile(created, SHEET_MIME_TYPE, spreadsheetTitle);
    await moveIntoFolder(host, spreadsheet, folder.id);
    await initializeOutreachSpreadsheet(host, spreadsheet.id);
  } else {
    if (!children.some((file) => file.id === spreadsheet?.id)) {
      await moveIntoFolder(host, spreadsheet, folder.id);
    }
    await initializeOutreachSpreadsheet(host, spreadsheet.id);
  }

  const now = new Date().toISOString();
  const workspace: ConnectorWorkspaceState = {
    folderId: folder.id,
    folderUrl: folder.webViewLink ?? folderUrl(folder.id),
    spreadsheetId: spreadsheet.id,
    spreadsheetUrl: spreadsheet.webViewLink ?? spreadsheetUrl(spreadsheet.id),
    profileEmail,
    updatedAt: now,
  };
  updateConnectorHostState(host, (current) => ({ ...current, workspace }));
  return { host, workspace };
}

export async function ensureConnectorWorkspace() {
  const selectedHost = await requireAgentConnectorHost("drive");
  const accountVersion = connectorAccountVersion();
  if (verifiedWorkspace?.host === selectedHost && verifiedWorkspace.accountVersion === connectorAccountVersion() && verifiedWorkspace.expiresAt > Date.now()) {
    return { host: selectedHost, workspace: verifiedWorkspace.workspace };
  }
  if (workspaceInFlight) {
    const pending = await workspaceInFlight;
    if (accountVersion !== connectorAccountVersion()) throw new Error("The Google connection changed. Retry this request.");
    if (pending.host === selectedHost) return pending;
  }
  const operation = createWorkspace();
  workspaceInFlight = operation;
  try {
    const resolved = await operation;
    if (accountVersion !== connectorAccountVersion() || resolved.host !== selectedHost) throw new Error("The Google connection changed. Retry this request.");
    verifiedWorkspace = { ...resolved, accountVersion, expiresAt: Date.now() + WORKSPACE_CACHE_MS };
    return resolved;
  } finally {
    if (workspaceInFlight === operation) workspaceInFlight = null;
  }
}
