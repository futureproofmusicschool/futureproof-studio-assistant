import assert from "node:assert/strict";
import test from "node:test";
import { firstString, unwrapConnectorResult } from "../lib/connectors/result";

test("unwrapConnectorResult handles structured MCP result envelopes", () => {
  assert.deepEqual(
    unwrapConnectorResult({
      content: [],
      structuredContent: { result: { id: "file-1", name: "Plan" } },
    }),
    { id: "file-1", name: "Plan" },
  );
});

test("unwrapConnectorResult parses JSON text content", () => {
  assert.deepEqual(
    unwrapConnectorResult({ content: [{ type: "text", text: '```json\n{"draftId":"draft-1"}\n```' }] }),
    { draftId: "draft-1" },
  );
});

test("connector record walking finds nested provider identifiers", () => {
  const value = { result: { file: { metadata: { webViewLink: "https://docs.google.com/document/d/file-1" } } } };
  assert.equal(firstString(value, ["webViewLink"]), "https://docs.google.com/document/d/file-1");
});

test("connector error envelopes fail instead of being mistaken for data", () => {
  assert.throws(
    () => unwrapConnectorResult({ isError: true, content: [{ type: "text", text: "Reconnect Google Drive." }] }),
    /Reconnect Google Drive/,
  );
});
