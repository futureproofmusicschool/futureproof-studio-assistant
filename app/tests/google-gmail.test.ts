import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGmailRawMessage,
  gmailDraftMessageId,
  gmailDraftPayloadDigest,
  gmailDraftSearchQuery,
  toBase64Url,
  validateGmailDraft,
} from "../lib/google/gmail-message";
import { gmailDraftRetryAction } from "../lib/google/gmail-retry";

function decodeBase64Url(value: string) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

test("toBase64Url emits Gmail-safe unpadded base64", () => {
  const encoded = toBase64Url(Buffer.from([251, 255, 254]));
  assert.equal(encoded, "-__-");
  assert.doesNotMatch(encoded, /[+/=]/);
});

test("buildGmailRawMessage produces an RFC 5322 draft payload", async () => {
  const messageId = gmailDraftMessageId("email:artist@example.com", "gemini-live:call-123");
  const raw = await buildGmailRawMessage({
    to: "listener@example.com",
    subject: "A finished track",
    body: "Here is the private link.\n\nThank you.",
  }, { messageId });
  const message = decodeBase64Url(raw);

  assert.match(message, /^To: listener@example\.com$/m);
  assert.match(message, /^Subject: A finished track$/m);
  assert.match(message, new RegExp(`^Message-ID: ${messageId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  assert.match(message, /Here is the private link\./);
  assert.doesNotMatch(raw, /[+/=]/);
});

test("draft Message-IDs are stable per account and operation", () => {
  const first = gmailDraftMessageId("email:artist@example.com", "gemini-live:call-123");
  assert.equal(
    first,
    gmailDraftMessageId("EMAIL:ARTIST@EXAMPLE.COM", "gemini-live:call-123"),
  );
  assert.notEqual(first, gmailDraftMessageId("email:other@example.com", "gemini-live:call-123"));
  assert.notEqual(first, gmailDraftMessageId("email:artist@example.com", "gemini-live:call-456"));
  assert.equal(gmailDraftSearchQuery(first), `rfc822msgid:${first.slice(1, -1)}`);
  assert.throws(() => gmailDraftMessageId("", "gemini-live:call-123"), /account identity/);
  assert.throws(() => gmailDraftMessageId("email:artist@example.com", ""), /operation id/);
});

test("draft payload binding normalizes fields and detects changed content", () => {
  const first = gmailDraftPayloadDigest({
    to: " listener@example.com ",
    subject: " A finished track ",
    body: " Body ",
  });
  assert.equal(
    first,
    gmailDraftPayloadDigest({
      to: "listener@example.com",
      subject: "A finished track",
      body: "Body",
    }),
  );
  assert.notEqual(
    first,
    gmailDraftPayloadDigest({
      to: "listener@example.com",
      subject: "A finished track",
      body: "Changed body",
    }),
  );
});

test("an attempted or legacy-pending draft is recovery-only on retry", () => {
  assert.equal(gmailDraftRetryAction(undefined), "create");
  assert.equal(gmailDraftRetryAction({ state: "pending", phase: "prepared" }), "create");
  assert.equal(gmailDraftRetryAction({ state: "pending", phase: "attempted" }), "recover-only");
  assert.equal(gmailDraftRetryAction({ state: "pending" }), "recover-only");
  assert.equal(gmailDraftRetryAction({ state: "complete" }), "replay");
});

test("validateGmailDraft refuses incomplete drafts", () => {
  assert.throws(
    () => validateGmailDraft({ to: "", subject: "Hello", body: "Body" }),
    /recipient/,
  );
  assert.throws(
    () => validateGmailDraft({ to: "person@example.com", subject: "", body: "Body" }),
    /subject/,
  );
  assert.throws(
    () => validateGmailDraft({ to: "person@example.com", subject: "Hello", body: "" }),
    /body/,
  );
});
