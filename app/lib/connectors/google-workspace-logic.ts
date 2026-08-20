export const CONNECTOR_CONTACT_HEADERS = [
  "id",
  "name",
  "role",
  "contact",
  "category",
  "status",
  "haveSamples",
  "notes",
  "lastContact",
  "createdAt",
  "updatedAt",
] as const;

export const OUTREACH_SPREADSHEET_NAME = "Futureproof Studio Assistant Outreach";
export const CONNECTOR_OUTREACH_SPREADSHEET_NAME = `${OUTREACH_SPREADSHEET_NAME} (Connector)`;

export type OutreachSchema = "connector" | "direct" | "uninitialized" | "unknown";

export function classifyOutreachContactHeader(header: readonly unknown[]): OutreachSchema {
  if (!header.length) return "uninitialized";
  if (
    header.length >= CONNECTOR_CONTACT_HEADERS.length &&
    CONNECTOR_CONTACT_HEADERS.every((name, index) => String(header[index]) === name)
  ) return "connector";
  if (
    String(header[0]) === "id" &&
    String(header[1]) === "personResourceName" &&
    String(header[2]) === "nameSnapshot"
  ) return "direct";
  return "unknown";
}

export function classifyOutreachSpreadsheet(input: {
  hasContactsSheet: boolean;
  contactHeader?: readonly unknown[];
}): OutreachSchema {
  if (!input.hasContactsSheet) return "uninitialized";
  return classifyOutreachContactHeader(input.contactHeader ?? []);
}

export function connectorOutreachSpreadsheetName(schema: OutreachSchema) {
  return schema === "direct" ? CONNECTOR_OUTREACH_SPREADSHEET_NAME : OUTREACH_SPREADSHEET_NAME;
}
