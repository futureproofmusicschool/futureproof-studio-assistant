import "server-only";

import fs from "node:fs";
import { google, type drive_v3, type sheets_v4 } from "googleapis";
import { getAuthorizedGoogleClient } from "@/lib/google/auth";
import { GOOGLE_SCOPES } from "@/lib/google/config";
import {
  googleCreateWasDefinitelyRejected,
  googleWorkspaceAccountTag,
} from "@/lib/google/workspace-logic";
import { readGoogleAuthorization, writePrivateGoogleJson } from "@/lib/google/store";
import { dataPath } from "@/lib/paths";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const DRIVE_FILE_FIELDS =
  "id,name,mimeType,webViewLink,createdTime,modifiedTime,appProperties,parents,trashed,ownedByMe";

/**
 * Drive appProperties are the durable discovery mechanism for a new checkout or
 * a second install. Names are human-facing and editable; these values are not.
 */
export const STUDIO_RESOURCE_PROPERTY = "futureproofStudioAssistant";
export const STUDIO_ACCOUNT_PROPERTY = "fsaAccount";
export const STUDIO_SCHEMA_PROPERTY = "fsaSchema";
export const STUDIO_RESOURCE_TAGS = {
  folder: "studio-folder-v1",
  outreachSpreadsheet: "outreach-spreadsheet-v1",
  document: "document-v1",
} as const;

const OUTREACH_SCHEMA_PENDING = "outreach-v1-pending";
const OUTREACH_SCHEMA_COMPLETE = "outreach-v1-complete";
const STUDIO_FOLDER_NAME = "Futureproof Studio Assistant";
const OUTREACH_SPREADSHEET_NAME = "Futureproof Studio Assistant Outreach";
const PROVISIONING_PATH = dataPath("google", "workspace-provisioning.json");

const CONTACT_HEADERS = [
  "id",
  "personResourceName",
  "nameSnapshot",
  "roleSnapshot",
  "contactSnapshot",
  "category",
  "status",
  "haveSamples",
  "notes",
  "lastContact",
  "createdAt",
  "updatedAt",
];
const HISTORY_HEADERS = ["id", "contactId", "date", "channel", "summary", "createdAt"];
const CATEGORY_HEADERS = ["id", "name", "position"];
const REQUIRED_SHEET_TITLES = ["Contacts", "History", "Categories"] as const;
const DEFAULT_CATEGORIES: (string | number)[][] = [
  ["collaborators", "Collaborators", 0],
  ["leads", "Leads", 1],
  ["label", "Labels", 2],
];

type ProvisioningKind = "folder" | "outreachSpreadsheet";
type ProvisioningRecord = {
  state: "creating" | "ready";
  fileId: string | null;
  startedAt: string;
  updatedAt: string;
};
type ProvisioningFile = {
  version: 1;
  accounts: Record<string, Partial<Record<ProvisioningKind, ProvisioningRecord>>>;
};

export type StudioFolder = {
  folderId: string;
  name: string;
  webViewLink: string;
  accountTag: string;
};

export type OutreachSpreadsheet = {
  spreadsheetId: string;
  name: string;
  webViewLink: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function readProvisioningFile(): ProvisioningFile {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(PROVISIONING_PATH, "utf8"));
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.accounts)) throw new Error();
    const accounts: ProvisioningFile["accounts"] = {};
    for (const [accountTag, kinds] of Object.entries(parsed.accounts)) {
      if (!/^a_[a-f0-9]{64}$/.test(accountTag) || !isRecord(kinds)) throw new Error();
      const account: Partial<Record<ProvisioningKind, ProvisioningRecord>> = {};
      for (const kind of ["folder", "outreachSpreadsheet"] as const) {
        const candidate = kinds[kind];
        if (candidate === undefined) continue;
        if (
          !isRecord(candidate) ||
          (candidate.state !== "creating" && candidate.state !== "ready") ||
          (candidate.fileId !== null && typeof candidate.fileId !== "string") ||
          !validTimestamp(candidate.startedAt) ||
          !validTimestamp(candidate.updatedAt)
        ) throw new Error();
        account[kind] = candidate as ProvisioningRecord;
      }
      accounts[accountTag] = account;
    }
    return { version: 1, accounts };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, accounts: {} };
    throw new Error("The Google Drive provisioning record is unreadable. It was left unchanged.");
  }
}

function provisioningRecord(accountTag: string, kind: ProvisioningKind) {
  return readProvisioningFile().accounts[accountTag]?.[kind] ?? null;
}

function writeProvisioningRecord(
  accountTag: string,
  kind: ProvisioningKind,
  update: ProvisioningRecord | null,
) {
  const file = readProvisioningFile();
  const account = file.accounts[accountTag] ?? {};
  if (update) account[kind] = update;
  else delete account[kind];
  if (Object.keys(account).length) file.accounts[accountTag] = account;
  else delete file.accounts[accountTag];
  writePrivateGoogleJson(PROVISIONING_PATH, file);
}

function beginProvisioning(accountTag: string, kind: ProvisioningKind) {
  const now = new Date().toISOString();
  writeProvisioningRecord(accountTag, kind, {
    state: "creating",
    fileId: null,
    startedAt: now,
    updatedAt: now,
  });
}

function finishProvisioning(accountTag: string, kind: ProvisioningKind, fileId: string) {
  const current = provisioningRecord(accountTag, kind);
  const now = new Date().toISOString();
  writeProvisioningRecord(accountTag, kind, {
    state: "ready",
    fileId,
    startedAt: current?.startedAt ?? now,
    updatedAt: now,
  });
}

function quoteDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function taggedQuery(tag: string, mimeType: string) {
  // Trashed files are intentionally included. Treating one as absent would
  // create a second workspace and split the user's data when the first is
  // restored later.
  return [
    `mimeType = '${quoteDriveQuery(mimeType)}'`,
    `appProperties has { key='${STUDIO_RESOURCE_PROPERTY}' and value='${quoteDriveQuery(tag)}' }`,
  ].join(" and ");
}

function requireFileIdentity(file: drive_v3.Schema$File, kind: string) {
  if (!file.id) throw new Error(`Google Drive did not return an id for the ${kind}.`);
  if (!file.webViewLink) throw new Error(`Google Drive did not return a link for the ${kind}.`);
  return {
    id: file.id,
    name: file.name || kind,
    webViewLink: file.webViewLink,
  };
}

async function driveClient() {
  const auth = await getAuthorizedGoogleClient([GOOGLE_SCOPES.driveFile]);
  return google.drive({ version: "v3", auth });
}

async function listTaggedFiles(tag: string, mimeType: string) {
  const drive = await driveClient();
  const files: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const response = await drive.files.list({
      q: taggedQuery(tag, mimeType),
      spaces: "drive",
      pageSize: 100,
      pageToken,
      orderBy: "createdTime asc",
      fields: `nextPageToken,files(${DRIVE_FILE_FIELDS})`,
    });
    files.push(...(response.data.files ?? []));
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  return files;
}

async function getDriveFile(fileId: string) {
  const drive = await driveClient();
  try {
    return (await drive.files.get({ fileId, fields: DRIVE_FILE_FIELDS })).data;
  } catch (error) {
    const status = Number(
      (error as { code?: unknown; response?: { status?: unknown } }).code ??
        (error as { response?: { status?: unknown } }).response?.status,
    );
    if (status === 404) return null;
    throw error;
  }
}

function accountCandidates(files: drive_v3.Schema$File[], accountTag: string) {
  return files.filter((file) => {
    const taggedAccount = file.appProperties?.[STUDIO_ACCOUNT_PROPERTY];
    return taggedAccount === accountTag || (!taggedAccount && file.ownedByMe === true);
  });
}

function uniqueCandidate(files: drive_v3.Schema$File[], kind: string) {
  if (files.length > 1) {
    throw new Error(
      `Google Drive contains multiple managed ${kind} resources for this account. No resource was selected; keep one and remove the duplicates, then retry.`,
    );
  }
  return files[0] ?? null;
}

function assertUsableManagedFile(
  file: drive_v3.Schema$File,
  accountTag: string,
  kind: string,
  options: { requireOwned: boolean; parentId?: string },
) {
  if (file.trashed) {
    throw new Error(`The managed ${kind} is in Google Drive trash. Restore it, then retry.`);
  }
  if (options.requireOwned && file.ownedByMe !== true) {
    throw new Error(`The managed ${kind} is not owned by the connected Google account. No resource was selected.`);
  }
  const taggedAccount = file.appProperties?.[STUDIO_ACCOUNT_PROPERTY];
  if (taggedAccount && taggedAccount !== accountTag) {
    throw new Error(`The managed ${kind} belongs to a different Google account. No resource was selected.`);
  }
  if (options.parentId && !file.parents?.includes(options.parentId)) {
    throw new Error(
      `The managed ${kind} was moved outside the dedicated Drive folder. Move it back, then retry.`,
    );
  }
}

async function adoptAccountTag(file: drive_v3.Schema$File, accountTag: string) {
  if (file.appProperties?.[STUDIO_ACCOUNT_PROPERTY] === accountTag) return file;
  if (!file.id) throw new Error("Google Drive returned a managed resource without an id.");
  const drive = await driveClient();
  return (
    await drive.files.update({
      fileId: file.id,
      requestBody: {
        appProperties: {
          ...(file.appProperties ?? {}),
          [STUDIO_ACCOUNT_PROPERTY]: accountTag,
        },
      },
      fields: DRIVE_FILE_FIELDS,
    })
  ).data;
}

function connectedWorkspaceAccount() {
  const authorization = readGoogleAuthorization();
  if (!authorization) throw new Error("Google is not connected. Sign in from Settings first.");
  const accountTag = googleWorkspaceAccountTag(authorization);
  return { accountTag, accountKey: accountTag };
}

export function connectedGoogleWorkspaceAccountTag() {
  return connectedWorkspaceAccount().accountTag;
}

function unresolvedCreateError(kind: string) {
  return new Error(
    `A previous Google Drive ${kind} create has an unknown outcome. Retry after Drive finishes syncing; Studio Assistant will recover the tagged resource and will not create a duplicate automatically.`,
  );
}

async function recoverProvisionedFile(
  accountTag: string,
  kind: ProvisioningKind,
  resourceName: string,
) {
  const record = provisioningRecord(accountTag, kind);
  if (!record) return null;
  if (record.fileId) {
    const file = await getDriveFile(record.fileId);
    if (!file) {
      throw new Error(
        `The previously provisioned Google Drive ${resourceName} is no longer accessible. No replacement was created.`,
      );
    }
    return file;
  }
  throw unresolvedCreateError(resourceName);
}

async function recoverAfterAmbiguousCreate(
  accountTag: string,
  kind: ProvisioningKind,
  resourceName: string,
  tag: string,
  mimeType: string,
) {
  try {
    const recovered = uniqueCandidate(
      accountCandidates(await listTaggedFiles(tag, mimeType), accountTag),
      resourceName,
    );
    if (recovered?.id) {
      finishProvisioning(accountTag, kind, recovered.id);
      return recovered;
    }
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("multiple managed")) {
      // Preserve the original ambiguous create state when recovery itself is
      // unavailable. A later retry performs the same safe lookup.
      return null;
    }
    throw error;
  }
  return null;
}

const folderInFlight = new Map<string, Promise<StudioFolder>>();

async function ensureStudioFolderUncached(accountTag: string): Promise<StudioFolder> {
  let found: drive_v3.Schema$File | null = uniqueCandidate(
    accountCandidates(await listTaggedFiles(STUDIO_RESOURCE_TAGS.folder, FOLDER_MIME_TYPE), accountTag),
    "studio folder",
  );
  if (!found) found = await recoverProvisionedFile(accountTag, "folder", "studio folder");

  if (found) {
    assertUsableManagedFile(found, accountTag, "studio folder", { requireOwned: true });
    found = await adoptAccountTag(found, accountTag);
    const file = requireFileIdentity(found, "studio folder");
    finishProvisioning(accountTag, "folder", file.id);
    return { folderId: file.id, name: file.name, webViewLink: file.webViewLink, accountTag };
  }

  beginProvisioning(accountTag, "folder");
  const drive = await driveClient();
  let created: drive_v3.Schema$File;
  try {
    created = (
      await drive.files.create({
        requestBody: {
          name: STUDIO_FOLDER_NAME,
          mimeType: FOLDER_MIME_TYPE,
          appProperties: {
            [STUDIO_RESOURCE_PROPERTY]: STUDIO_RESOURCE_TAGS.folder,
            [STUDIO_ACCOUNT_PROPERTY]: accountTag,
          },
        },
        fields: DRIVE_FILE_FIELDS,
      })
    ).data;
  } catch (error) {
    if (googleCreateWasDefinitelyRejected(error)) {
      writeProvisioningRecord(accountTag, "folder", null);
      throw error;
    }
    const recovered = await recoverAfterAmbiguousCreate(
      accountTag,
      "folder",
      "studio folder",
      STUDIO_RESOURCE_TAGS.folder,
      FOLDER_MIME_TYPE,
    );
    if (!recovered) throw unresolvedCreateError("studio folder");
    created = recovered;
  }
  assertUsableManagedFile(created, accountTag, "studio folder", { requireOwned: true });
  const file = requireFileIdentity(created, "studio folder");
  finishProvisioning(accountTag, "folder", file.id);
  return { folderId: file.id, name: file.name, webViewLink: file.webViewLink, accountTag };
}

export async function ensureStudioFolder(): Promise<StudioFolder> {
  const { accountKey, accountTag } = connectedWorkspaceAccount();
  const existing = folderInFlight.get(accountKey);
  if (existing) return existing;
  const pending = ensureStudioFolderUncached(accountTag);
  folderInFlight.set(accountKey, pending);
  try {
    return await pending;
  } finally {
    if (folderInFlight.get(accountKey) === pending) folderInFlight.delete(accountKey);
  }
}

function sheetProperties(data: sheets_v4.Schema$Spreadsheet) {
  return (data.sheets ?? [])
    .map((sheet) => sheet.properties)
    .filter((sheet): sheet is NonNullable<typeof sheet> => Boolean(sheet?.sheetId !== undefined && sheet.title));
}

function exactTitleSet(properties: sheets_v4.Schema$SheetProperties[], expected: readonly string[]) {
  const titles = properties.map((property) => property.title as string);
  return titles.length === expected.length && expected.every((title) => titles.includes(title));
}

async function readSheetProperties(spreadsheetId: string) {
  const auth = await getAuthorizedGoogleClient([GOOGLE_SCOPES.driveFile]);
  const sheets = google.sheets({ version: "v4", auth });
  const current = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  return { sheets, properties: sheetProperties(current.data) };
}

async function ensurePendingSheetTabs(spreadsheetId: string) {
  const { sheets, properties } = await readSheetProperties(spreadsheetId);
  if (exactTitleSet(properties, REQUIRED_SHEET_TITLES)) return;
  if (!(properties.length === 1 && properties[0].title === "Sheet1")) {
    throw new Error(
      "The pending outreach Sheet has unexpected or renamed tabs. It was left unchanged; restore Contacts, History, and Categories before retrying.",
    );
  }

  const existingValues = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Sheet1'",
  });
  const hasContent = (existingValues.data.values ?? []).some((row) =>
    row.some((cell) => String(cell ?? "").trim() !== ""),
  );
  if (hasContent) {
    throw new Error(
      "The pending outreach Sheet's default Sheet1 contains content. It was left unchanged; move or clear that content before retrying.",
    );
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId: properties[0].sheetId, title: "Contacts" },
            fields: "title",
          },
        },
        { addSheet: { properties: { title: "History" } } },
        { addSheet: { properties: { title: "Categories" } } },
      ],
    },
  });
}

function sameRow(actual: unknown[], expected: readonly string[]) {
  return (
    expected.every((value, index) => String(actual[index] ?? "") === value) &&
    actual.slice(expected.length).every((value) => String(value ?? "") === "")
  );
}

async function readSheetHeaderValues(spreadsheetId: string) {
  const auth = await getAuthorizedGoogleClient([GOOGLE_SCOPES.driveFile]);
  const sheets = google.sheets({ version: "v4", auth });
  const reads = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: ["Contacts!1:2", "History!1:2", "Categories!1:4"],
  });
  return {
    sheets,
    contacts: reads.data.valueRanges?.[0]?.values ?? [],
    history: reads.data.valueRanges?.[1]?.values ?? [],
    categories: reads.data.valueRanges?.[2]?.values ?? [],
  };
}

async function initializePendingSheetValues(spreadsheetId: string) {
  const { sheets, contacts, history, categories } = await readSheetHeaderValues(spreadsheetId);
  const writes: Array<{ range: string; values: (string | number)[][] }> = [];

  if (!contacts[0]?.length) writes.push({ range: "Contacts!A1", values: [CONTACT_HEADERS] });
  else if (!sameRow(contacts[0], CONTACT_HEADERS)) {
    throw new Error("The Studio Assistant outreach Sheet has unexpected Contacts columns; it was left unchanged.");
  }
  if (!history[0]?.length) writes.push({ range: "History!A1", values: [HISTORY_HEADERS] });
  else if (!sameRow(history[0], HISTORY_HEADERS)) {
    throw new Error("The Studio Assistant outreach Sheet has unexpected History columns; it was left unchanged.");
  }
  if (!categories[0]?.length) {
    writes.push({ range: "Categories!A1", values: [CATEGORY_HEADERS, ...DEFAULT_CATEGORIES] });
  } else if (!sameRow(categories[0], CATEGORY_HEADERS)) {
    throw new Error("The Studio Assistant outreach Sheet has unexpected Categories columns; it was left unchanged.");
  } else if (categories.length === 1) {
    writes.push({ range: "Categories!A2", values: DEFAULT_CATEGORIES });
  }

  if (writes.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: writes },
    });
  }
}

async function validateCompleteSheetSchema(spreadsheetId: string) {
  const { properties } = await readSheetProperties(spreadsheetId);
  const titles = new Set(properties.map((property) => property.title as string));
  const missing = REQUIRED_SHEET_TITLES.filter((title) => !titles.has(title));
  if (missing.length) {
    throw new Error(
      `The Studio Assistant outreach Sheet is missing or has renamed tabs: ${missing.join(", ")}. It was left unchanged.`,
    );
  }

  const { contacts, history, categories } = await readSheetHeaderValues(spreadsheetId);
  if (!contacts[0]?.length || !sameRow(contacts[0], CONTACT_HEADERS)) {
    throw new Error("The Studio Assistant outreach Sheet has unexpected Contacts columns; it was left unchanged.");
  }
  if (!history[0]?.length || !sameRow(history[0], HISTORY_HEADERS)) {
    throw new Error("The Studio Assistant outreach Sheet has unexpected History columns; it was left unchanged.");
  }
  if (!categories[0]?.length || !sameRow(categories[0], CATEGORY_HEADERS)) {
    throw new Error("The Studio Assistant outreach Sheet has unexpected Categories columns; it was left unchanged.");
  }
}

async function updateManagedFileProperties(file: drive_v3.Schema$File, properties: Record<string, string>) {
  if (!file.id) throw new Error("Google Drive returned a managed resource without an id.");
  const drive = await driveClient();
  return (
    await drive.files.update({
      fileId: file.id,
      requestBody: { appProperties: { ...(file.appProperties ?? {}), ...properties } },
      fields: DRIVE_FILE_FIELDS,
    })
  ).data;
}

async function ensureOutreachSchema(file: drive_v3.Schema$File, accountTag: string) {
  if (!file.id) throw new Error("Google Drive returned an outreach Sheet without an id.");
  const spreadsheetId = file.id;
  let schemaState = file.appProperties?.[STUDIO_SCHEMA_PROPERTY];
  if (schemaState === OUTREACH_SCHEMA_COMPLETE) {
    await validateCompleteSheetSchema(file.id);
    return;
  }
  if (schemaState && schemaState !== OUTREACH_SCHEMA_PENDING) {
    throw new Error("The Studio Assistant outreach Sheet has an unsupported schema marker; it was left unchanged.");
  }

  if (!schemaState) {
    // Safely adopt a Sheet from the first Google-backed build. Only the pristine
    // default layout or an already complete managed layout is recognizable.
    const { properties } = await readSheetProperties(spreadsheetId);
    const titles = new Set(properties.map((property) => property.title as string));
    const hasAllManagedTabs = REQUIRED_SHEET_TITLES.every((title) => titles.has(title));
    const pristine = properties.length === 1 && properties[0].title === "Sheet1";
    if (!pristine && !hasAllManagedTabs) {
      throw new Error(
        "The existing outreach Sheet has missing or renamed tabs and no completed schema marker. It was left unchanged.",
      );
    }
    if (hasAllManagedTabs) {
      try {
        await validateCompleteSheetSchema(spreadsheetId);
        await updateManagedFileProperties(file, {
          [STUDIO_ACCOUNT_PROPERTY]: accountTag,
          [STUDIO_SCHEMA_PROPERTY]: OUTREACH_SCHEMA_COMPLETE,
        });
        return;
      } catch (error) {
        const headers = await readSheetHeaderValues(spreadsheetId);
        const allBlank =
          !headers.contacts[0]?.length && !headers.history[0]?.length && !headers.categories[0]?.length;
        if (!allBlank || !exactTitleSet(properties, REQUIRED_SHEET_TITLES)) throw error;
      }
    }
    file = await updateManagedFileProperties(file, {
      [STUDIO_ACCOUNT_PROPERTY]: accountTag,
      [STUDIO_SCHEMA_PROPERTY]: OUTREACH_SCHEMA_PENDING,
    });
    schemaState = OUTREACH_SCHEMA_PENDING;
  }

  if (schemaState === OUTREACH_SCHEMA_PENDING) {
    await ensurePendingSheetTabs(spreadsheetId);
    await initializePendingSheetValues(spreadsheetId);
    await validateCompleteSheetSchema(spreadsheetId);
    await updateManagedFileProperties(file, {
      [STUDIO_ACCOUNT_PROPERTY]: accountTag,
      [STUDIO_SCHEMA_PROPERTY]: OUTREACH_SCHEMA_COMPLETE,
    });
  }
}

const outreachInFlight = new Map<string, Promise<OutreachSpreadsheet>>();

async function ensureOutreachSpreadsheetUncached(
  accountTag: string,
): Promise<OutreachSpreadsheet> {
  const folder = await ensureStudioFolder();
  let file: drive_v3.Schema$File | null = uniqueCandidate(
    accountCandidates(
      await listTaggedFiles(STUDIO_RESOURCE_TAGS.outreachSpreadsheet, SPREADSHEET_MIME_TYPE),
      accountTag,
    ),
    "outreach Sheet",
  );
  if (!file) file = await recoverProvisionedFile(accountTag, "outreachSpreadsheet", "outreach Sheet");

  if (file) {
    assertUsableManagedFile(file, accountTag, "outreach Sheet", {
      requireOwned: true,
      parentId: folder.folderId,
    });
    file = await adoptAccountTag(file, accountTag);
  } else {
    beginProvisioning(accountTag, "outreachSpreadsheet");
    const drive = await driveClient();
    try {
      file = (
        await drive.files.create({
          requestBody: {
            name: OUTREACH_SPREADSHEET_NAME,
            mimeType: SPREADSHEET_MIME_TYPE,
            parents: [folder.folderId],
            appProperties: {
              [STUDIO_RESOURCE_PROPERTY]: STUDIO_RESOURCE_TAGS.outreachSpreadsheet,
              [STUDIO_ACCOUNT_PROPERTY]: accountTag,
              [STUDIO_SCHEMA_PROPERTY]: OUTREACH_SCHEMA_PENDING,
            },
          },
          fields: DRIVE_FILE_FIELDS,
        })
      ).data;
    } catch (error) {
      if (googleCreateWasDefinitelyRejected(error)) {
        writeProvisioningRecord(accountTag, "outreachSpreadsheet", null);
        throw error;
      }
      file = await recoverAfterAmbiguousCreate(
        accountTag,
        "outreachSpreadsheet",
        "outreach Sheet",
        STUDIO_RESOURCE_TAGS.outreachSpreadsheet,
        SPREADSHEET_MIME_TYPE,
      );
      if (!file) throw unresolvedCreateError("outreach Sheet");
    }
    assertUsableManagedFile(file, accountTag, "outreach Sheet", {
      requireOwned: true,
      parentId: folder.folderId,
    });
  }

  const identity = requireFileIdentity(file, "outreach spreadsheet");
  finishProvisioning(accountTag, "outreachSpreadsheet", identity.id);
  await ensureOutreachSchema(file, accountTag);
  return { spreadsheetId: identity.id, name: identity.name, webViewLink: identity.webViewLink };
}

export async function ensureOutreachSpreadsheet(): Promise<OutreachSpreadsheet> {
  const { accountKey, accountTag } = connectedWorkspaceAccount();
  const existing = outreachInFlight.get(accountKey);
  if (existing) return existing;
  const pending = ensureOutreachSpreadsheetUncached(accountTag);
  outreachInFlight.set(accountKey, pending);
  try {
    return await pending;
  } finally {
    if (outreachInFlight.get(accountKey) === pending) outreachInFlight.delete(accountKey);
  }
}

export const GOOGLE_WORKSPACE_PROVISIONING_PATH = PROVISIONING_PATH;
