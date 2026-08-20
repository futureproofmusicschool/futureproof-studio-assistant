import "server-only";

import { createHash } from "node:crypto";
import type { CreateGmailDraftInput, GmailDraftResult } from "@/lib/google/gmail";
import { gmailDraftPayloadDigest, validateGmailDraft } from "@/lib/google/gmail-message";
import { callGoogleConnectorTool, requireAgentConnectorHost } from "@/lib/connectors/google-runtime";
import { firstString, isRecord, unwrapConnectorResult } from "@/lib/connectors/result";
import {
  readConnectorHostState,
  updateConnectorHostState,
  type AgentConnectorHost,
  type ConnectorDraftIntent,
} from "@/lib/connectors/state";

const MAX_OPERATION_ID_CHARS = 1_000;
const draftOperationsInFlight = new Map<
  string,
  { payloadHash: string; promise: Promise<GmailDraftResult> }
>();

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredOperationId(value: string) {
  const operationId = value.trim();
  if (!operationId) throw new Error("A stable operation id is required for a Gmail draft.");
  if (operationId.length > MAX_OPERATION_ID_CHARS) throw new Error("The Gmail draft operation id is too long.");
  return operationId;
}

function draftsLink(email: string | null) {
  return email
    ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#drafts`
    : "https://mail.google.com/mail/u/0/#drafts";
}

function saveIntent(host: AgentConnectorHost, key: string, intent: ConnectorDraftIntent) {
  updateConnectorHostState(host, (current) => ({
    ...current,
    draftIntents: { ...current.draftIntents, [key]: intent },
  }));
}

function resultFromIntent(
  intent: ConnectorDraftIntent,
  profileEmail: string | null,
  recovered: boolean,
): GmailDraftResult {
  if (intent.state !== "complete" || !intent.draftId) {
    throw new Error("The Gmail draft operation has not completed yet.");
  }
  return {
    draftId: intent.draftId,
    createdAt: intent.createdAt,
    messageId: intent.messageId ?? null,
    threadId: intent.threadId ?? null,
    webViewLink: intent.webViewLink ?? draftsLink(profileEmail),
    provider: "gmail",
    sent: false,
    recovered,
  };
}

async function executeConnectorDraft(input: CreateGmailDraftInput): Promise<GmailDraftResult> {
  const operationId = requiredOperationId(input.operationId);
  const draft = validateGmailDraft(input);
  const host = await requireAgentConnectorHost("gmail");
  const key = digest(operationId);
  const payloadHash = gmailDraftPayloadDigest(draft);
  const hostState = readConnectorHostState(host);
  const existing = hostState.draftIntents[key];
  const profileEmail = hostState.workspace?.profileEmail ?? null;
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      throw new Error("That Gmail draft operation id was already used with different recipients or content.");
    }
    if (existing.state === "complete") return resultFromIntent(existing, profileEmail, true);
    throw new Error(
      "That Gmail draft may already exist, but the connector did not confirm it. Review Gmail Drafts before starting a new draft operation.",
    );
  }

  const profile = await callGoogleConnectorTool(host, "gmail", "gmail_get_profile", {});
  const email = firstString(profile, ["emailAddress", "email_address", "email", "userEmail"]);
  if (!email) throw new Error("Gmail did not identify its connected account. Reconnect Gmail before creating a draft.");
  if (profileEmail && email && profileEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
    throw new Error(
      "Google Drive and Gmail are connected to different accounts. Reconnect them to the same Google account before creating a draft.",
    );
  }
  const now = new Date().toISOString();
  const pending: ConnectorDraftIntent = {
    operationId,
    payloadHash,
    state: "pending",
    createdAt: now,
    updatedAt: now,
  };
  saveIntent(host, key, pending);

  let response: unknown;
  try {
    response = await callGoogleConnectorTool(host, "gmail", "gmail_create_draft", {
      to: draft.to,
      subject: draft.subject,
      payload: {
        mime_type: "text/plain",
        charset: "UTF-8",
        body: { content: draft.body },
      },
      response_fields: ["id", "message"],
    });
  } catch (error) {
    saveIntent(host, key, { ...pending, state: "ambiguous", updatedAt: new Date().toISOString() });
    throw new Error(
      "Gmail did not confirm whether the connector created the draft. Review Gmail Drafts before starting a new operation.",
      { cause: error },
    );
  }

  const unwrapped = unwrapConnectorResult(response);
  const root = isRecord(unwrapped) ? unwrapped : null;
  const result = root && isRecord(root.result) ? root.result : root;
  const draftId = result && typeof result.id === "string"
    ? result.id
    : firstString(unwrapped, ["draftId", "draft_id", "id"]);
  const message = result && isRecord(result.message) ? result.message : null;
  const messageId = message && typeof message.id === "string"
    ? message.id
    : firstString(message, ["messageId", "message_id"]);
  const threadId = message && typeof message.threadId === "string"
    ? message.threadId
    : firstString(message, ["thread_id"]);
  if (!draftId) {
    saveIntent(host, key, { ...pending, state: "ambiguous", updatedAt: new Date().toISOString() });
    throw new Error(
      "Gmail accepted the connector call but did not return a draft id. Review Gmail Drafts before starting a new operation.",
    );
  }
  const complete: ConnectorDraftIntent = {
    ...pending,
    state: "complete",
    updatedAt: new Date().toISOString(),
    draftId,
    messageId,
    threadId,
    webViewLink: draftsLink(email),
  };
  saveIntent(host, key, complete);
  return resultFromIntent(complete, email, false);
}

export async function createConnectorGmailDraft(input: CreateGmailDraftInput) {
  const operationId = requiredOperationId(input.operationId);
  const key = digest(operationId);
  const payloadHash = gmailDraftPayloadDigest(validateGmailDraft(input));
  const existing = draftOperationsInFlight.get(key);
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      throw new Error("That Gmail draft operation id is already running with different recipients or content.");
    }
    return existing.promise;
  }
  const pending = executeConnectorDraft(input);
  draftOperationsInFlight.set(key, { payloadHash, promise: pending });
  try {
    return await pending;
  } finally {
    if (draftOperationsInFlight.get(key)?.promise === pending) draftOperationsInFlight.delete(key);
  }
}
