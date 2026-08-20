import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECTOR_CONTACT_HEADERS,
  CONNECTOR_OUTREACH_SPREADSHEET_NAME,
  OUTREACH_SPREADSHEET_NAME,
  classifyOutreachContactHeader,
  classifyOutreachSpreadsheet,
  connectorOutreachSpreadsheetName,
} from "../lib/connectors/google-workspace-logic";

test("classifies the connector-native outreach Contacts header", () => {
  assert.equal(classifyOutreachContactHeader(CONNECTOR_CONTACT_HEADERS), "connector");
  assert.equal(
    classifyOutreachContactHeader([...CONNECTOR_CONTACT_HEADERS, "futureColumn"]),
    "connector",
  );
});

test("classifies the Advanced direct-OAuth Contacts header without sharing its schema", () => {
  assert.equal(
    classifyOutreachContactHeader([
      "id",
      "personResourceName",
      "nameSnapshot",
      "role",
      "category",
      "status",
    ]),
    "direct",
  );
});

test("treats a blank Contacts tab as resumable initialization", () => {
  assert.equal(classifyOutreachContactHeader([]), "uninitialized");
  assert.equal(
    classifyOutreachSpreadsheet({ hasContactsSheet: true, contactHeader: [] }),
    "uninitialized",
  );
});

test("treats a default Sheet1 or interrupted create as resumable initialization", () => {
  assert.equal(
    classifyOutreachSpreadsheet({ hasContactsSheet: false }),
    "uninitialized",
  );
});

test("does not reinterpret an unknown or manually altered Contacts header", () => {
  assert.equal(
    classifyOutreachContactHeader([
      "id",
      "displayName",
      "email",
    ]),
    "unknown",
  );
  assert.equal(
    classifyOutreachContactHeader([
      ...CONNECTOR_CONTACT_HEADERS.slice(0, 5),
      "manuallyChangedStatus",
      ...CONNECTOR_CONTACT_HEADERS.slice(6),
    ]),
    "unknown",
  );
});

test("only a direct-OAuth schema selects the connector-specific sibling title", () => {
  assert.equal(connectorOutreachSpreadsheetName("connector"), OUTREACH_SPREADSHEET_NAME);
  assert.equal(connectorOutreachSpreadsheetName("uninitialized"), OUTREACH_SPREADSHEET_NAME);
  assert.equal(connectorOutreachSpreadsheetName("unknown"), OUTREACH_SPREADSHEET_NAME);
  assert.equal(connectorOutreachSpreadsheetName("direct"), CONNECTOR_OUTREACH_SPREADSHEET_NAME);
});
