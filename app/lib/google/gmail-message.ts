import { createHash } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";

const MAX_RECIPIENT_CHARS = 2_000;
const MAX_SUBJECT_CHARS = 500;
const MAX_BODY_CHARS = 400 * 1024;

export type GmailDraftInput = {
  to: string;
  subject: string;
  body: string;
};

export type GmailDraftMessageOptions = {
  messageId?: string;
};

function requiredText(value: string, label: string, maximum: number) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`An email draft needs ${label}.`);
  if (trimmed.length > maximum) throw new Error(`The email ${label} is too long.`);
  return trimmed;
}

export function validateGmailDraft(input: GmailDraftInput): GmailDraftInput {
  return {
    to: requiredText(input.to, "at least one recipient", MAX_RECIPIENT_CHARS),
    subject: requiredText(input.subject, "a subject", MAX_SUBJECT_CHARS),
    body: requiredText(input.body, "a body", MAX_BODY_CHARS),
  };
}

export function toBase64Url(value: Buffer | string) {
  const encoded = Buffer.isBuffer(value) ? value.toString("base64") : Buffer.from(value).toString("base64");
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function compactDigest(value: string) {
  return createHash("sha256")
    .update(value)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** Stable payload binding used to reject an operation id reused with changed mail. */
export function gmailDraftPayloadDigest(input: GmailDraftInput) {
  const draft = validateGmailDraft(input);
  return digest(JSON.stringify(draft));
}

/** Account identity is hashed into the id; no address is exposed in the header. */
export function gmailDraftMessageId(accountIdentity: string, operationId: string) {
  const account = accountIdentity.trim().toLowerCase();
  const operation = operationId.trim();
  if (!account) throw new Error("A Gmail account identity is required for a draft operation.");
  if (!operation) throw new Error("A stable operation id is required for a Gmail draft.");
  return `<fsa-${compactDigest(`gmail-draft-v1\0${account}\0${operation}`)}@fsa.invalid>`;
}

export function gmailDraftSearchQuery(messageId: string) {
  const token = messageId.trim().replace(/^<|>$/g, "");
  if (!token) throw new Error("A Message-ID is required to recover a Gmail draft.");
  return `rfc822msgid:${token}`;
}

/** Build the RFC 5322 message Gmail expects, including safe UTF-8 headers. */
export async function buildGmailRawMessage(
  input: GmailDraftInput,
  options: GmailDraftMessageOptions = {},
) {
  const draft = validateGmailDraft(input);
  const message = await new MailComposer({
    to: draft.to,
    subject: draft.subject,
    text: draft.body,
    textEncoding: "quoted-printable",
    ...(options.messageId ? { messageId: options.messageId } : {}),
  })
    .compile()
    .build();
  return toBase64Url(message);
}
