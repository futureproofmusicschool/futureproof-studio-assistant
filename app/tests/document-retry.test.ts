import assert from "node:assert/strict";
import test from "node:test";
import { pendingDocumentWriteAction } from "../lib/document-retry";

test("a freshly-created blank Google Doc may receive its first body write", () => {
  assert.equal(
    pendingDocumentWriteAction({
      marker: "absent",
      currentPlainText: "",
      intendedPlainText: "Planned body",
      allowBlankWrite: true,
    }),
    "write",
  );
});

test("a recovered pending Doc completes metadata when its body is unchanged", () => {
  assert.equal(
    pendingDocumentWriteAction({
      marker: "match",
      currentPlainText: "Planned body\n",
      intendedPlainText: "Planned body",
      allowBlankWrite: false,
    }),
    "complete",
  );
  assert.equal(
    pendingDocumentWriteAction({
      marker: "absent",
      currentPlainText: "Planned body",
      intendedPlainText: "Planned body",
      allowBlankWrite: false,
    }),
    "complete",
    "legacy pending files without a marker recover by exact content",
  );
});

test("a recovered pending Doc never overwrites later human edits", () => {
  assert.equal(
    pendingDocumentWriteAction({
      marker: "match",
      currentPlainText: "Planned body",
      intendedPlainText: "Planned body",
      allowBlankWrite: false,
      currentTitle: "Human title",
      intendedTitle: "Planned title",
    }),
    "conflict",
    "a later human rename is not overwritten by metadata completion",
  );
  assert.equal(
    pendingDocumentWriteAction({
      marker: "match",
      currentPlainText: "Planned body\nHuman edit",
      intendedPlainText: "Planned body",
      allowBlankWrite: false,
    }),
    "conflict",
  );
  assert.equal(
    pendingDocumentWriteAction({
      marker: "absent",
      currentPlainText: "",
      intendedPlainText: "Planned body",
      allowBlankWrite: false,
    }),
    "conflict",
    "an old pending blank might be a human deletion and is left untouched",
  );
  assert.equal(
    pendingDocumentWriteAction({
      marker: "conflict",
      currentPlainText: "Planned body",
      intendedPlainText: "Planned body",
      allowBlankWrite: false,
    }),
    "conflict",
    "a marker for different payload always conflicts",
  );
});
