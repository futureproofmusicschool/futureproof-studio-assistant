import "server-only";

import { createHash } from "node:crypto";
import fs from "node:fs";
import { google, type gmail_v1 } from "googleapis";
import { getAuthorizedGoogleClient } from "@/lib/google/auth";
import { GOOGLE_SCOPES } from "@/lib/google/config";
import { gmailDraftRetryAction } from "@/lib/google/gmail-retry";
import {
  buildGmailRawMessage,
  gmailDraftMessageId,
  gmailDraftPayloadDigest,
  gmailDraftSearchQuery,
  validateGmailDraft,
  type GmailDraftInput,
} from "@/lib/google/gmail-message";
import { readGoogleAuthorization, writePrivateGoogleJson } from "@/lib/google/store";
import { dataPath } from "@/lib/paths";
import { usesAgentGoogleConnectors } from "@/lib/connectors/google-runtime";
import { createConnectorGmailDraft } from "@/lib/connectors/google-gmail";

export {
  buildGmailRawMessage,
  gmailDraftMessageId,
  gmailDraftPayloadDigest,
  gmailDraftSearchQuery,
  toBase64Url,
  validateGmailDraft,
} from "@/lib/google/gmail-message";
export type { GmailDraftInput } from "@/lib/google/gmail-message";

const MAX_OPERATION_ID_CHARS = 1_000;
const RECOVERY_DELAYS_MS = [0, 200, 500, 1_000, 2_000] as const;

export type CreateGmailDraftInput = GmailDraftInput & { operationId: string };

export type GmailDraftResult = {
  draftId: string;
  createdAt: string;
  messageId: string | null;
  threadId: string | null;
  webViewLink: string;
  provider: "gmail";
  sent: false;
  /** True when a prior call committed and this call recovered/replayed it. */
  recovered: boolean;
};

type DraftIntent = {
  operationKey: string;
  payloadDigest: string;
  rfcMessageId: string;
  state: "pending" | "complete";
  phase?: "prepared" | "attempted";
  createdAt: string;
  updatedAt: string;
  draftId?: string;
  messageId?: string | null;
  threadId?: string | null;
};

type DraftIntentFile = {
  version: 1;
  accountKey: string;
  intents: Record<string, DraftIntent>;
};

type GmailAccount = {
  identity: string;
  accountKey: string;
  email: string;
  intentPath: string;
};

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredOperationId(value: string) {
  const operationId = value.trim();
  if (!operationId) throw new Error("A stable operation id is required for a Gmail draft.");
  if (operationId.length > MAX_OPERATION_ID_CHARS) throw new Error("The Gmail draft operation id is too long.");
  return operationId;
}

function gmailDraftsLink(email: string) {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#drafts`;
}

async function resolveGmailAccount(gmail: gmail_v1.Gmail): Promise<GmailAccount> {
  const authorization = readGoogleAuthorization();
  let email = authorization?.email?.trim().toLowerCase() ?? "";
  if (!email) {
    const profile = await gmail.users.getProfile({ userId: "me" });
    email = profile.data.emailAddress?.trim().toLowerCase() ?? "";
  }
  if (!email) {
    throw new Error("Google did not identify the connected Gmail account. Reconnect it in Settings.");
  }

  const identity = authorization?.subject?.trim()
    ? `subject:${authorization.subject.trim()}`
    : `email:${email}`;
  const accountKey = digest(identity);
  return {
    identity,
    accountKey,
    email,
    intentPath: dataPath("google", `gmail-draft-intents-${accountKey}.json`),
  };
}

function validIntent(value: unknown): value is DraftIntent {
  if (typeof value !== "object" || value === null) return false;
  const intent = value as Partial<DraftIntent>;
  return (
    typeof intent.operationKey === "string" &&
    typeof intent.payloadDigest === "string" &&
    typeof intent.rfcMessageId === "string" &&
    (intent.state === "pending" || intent.state === "complete") &&
    (intent.phase === undefined || intent.phase === "prepared" || intent.phase === "attempted") &&
    typeof intent.createdAt === "string" &&
    typeof intent.updatedAt === "string" &&
    (intent.draftId === undefined || typeof intent.draftId === "string") &&
    (intent.messageId === undefined || intent.messageId === null || typeof intent.messageId === "string") &&
    (intent.threadId === undefined || intent.threadId === null || typeof intent.threadId === "string")
  );
}

function emptyIntentFile(accountKey: string): DraftIntentFile {
  return { version: 1, accountKey, intents: {} };
}

function readDraftIntents(account: GmailAccount): DraftIntentFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(account.intentPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyIntentFile(account.accountKey);
    if (error instanceof SyntaxError) {
      throw new Error(
        "The local Gmail draft retry state is unreadable. It was left untouched so Studio Assistant will not risk creating duplicate drafts.",
      );
    }
    throw error;
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("The local Gmail draft retry state is invalid; no draft was created.");
  }
  const file = parsed as Partial<DraftIntentFile>;
  if (
    file.version !== 1 ||
    file.accountKey !== account.accountKey ||
    typeof file.intents !== "object" ||
    file.intents === null ||
    Object.values(file.intents).some((intent) => !validIntent(intent))
  ) {
    throw new Error("The local Gmail draft retry state is invalid; no draft was created.");
  }
  return file as DraftIntentFile;
}

function writeDraftIntent(account: GmailAccount, intent: DraftIntent) {
  const current = readDraftIntents(account);
  writePrivateGoogleJson(account.intentPath, {
    ...current,
    intents: { ...current.intents, [intent.operationKey]: intent },
  } satisfies DraftIntentFile);
}

function resultFromIntent(intent: DraftIntent, account: GmailAccount, recovered: boolean): GmailDraftResult {
  if (intent.state !== "complete" || !intent.draftId) {
    throw new Error("The Gmail draft operation has not completed yet.");
  }
  return {
    draftId: intent.draftId,
    createdAt: intent.createdAt,
    messageId: intent.messageId ?? null,
    threadId: intent.threadId ?? null,
    webViewLink: gmailDraftsLink(account.email),
    provider: "gmail",
    sent: false,
    recovered,
  };
}

function completeIntent(
  account: GmailAccount,
  intent: DraftIntent,
  draft: { id: string; message?: { id?: string | null; threadId?: string | null } | null },
) {
  const complete: DraftIntent = {
    ...intent,
    state: "complete",
    updatedAt: new Date().toISOString(),
    draftId: draft.id,
    messageId: draft.message?.id ?? null,
    threadId: draft.message?.threadId ?? null,
  };
  // This write happens after Gmail's mutation. If it fails, the pending record
  // remains and the next retry recovers by deterministic Message-ID.
  writeDraftIntent(account, complete);
  return complete;
}

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | null | undefined, name: string) {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? "";
}

async function findDraftByMessageId(gmail: gmail_v1.Gmail, rfcMessageId: string) {
  let pageToken: string | undefined;
  do {
    const listed = await gmail.users.drafts.list({
      userId: "me",
      q: gmailDraftSearchQuery(rfcMessageId),
      maxResults: 50,
      pageToken,
    });
    for (const candidate of listed.data.drafts ?? []) {
      if (!candidate.id) continue;
      const detail = await gmail.users.drafts.get({
        userId: "me",
        id: candidate.id,
        format: "metadata",
      });
      if (headerValue(detail.data.message?.payload?.headers, "Message-ID") === rfcMessageId) {
        return detail.data;
      }
    }
    pageToken = listed.data.nextPageToken ?? undefined;
  } while (pageToken);
  return null;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function recoverWithBoundedWait(gmail: gmail_v1.Gmail, rfcMessageId: string) {
  let lastError: unknown;
  for (const delay of RECOVERY_DELAYS_MS) {
    if (delay) await wait(delay);
    try {
      const recovered = await findDraftByMessageId(gmail, rfcMessageId);
      if (recovered) return recovered;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

function responseStatus(error: unknown) {
  const candidate = error as { code?: unknown; response?: { status?: unknown } };
  const value = candidate?.response?.status ?? candidate?.code;
  const status = typeof value === "string" ? Number(value) : value;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

function ambiguousCreateError(error: unknown) {
  const status = responseStatus(error);
  return status === null || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function executeDraftOperation(
  gmail: gmail_v1.Gmail,
  account: GmailAccount,
  draft: GmailDraftInput,
  operationId: string,
) {
  const payloadDigest = gmailDraftPayloadDigest(draft);
  const rfcMessageId = gmailDraftMessageId(account.identity, operationId);
  const operationKey = digest(rfcMessageId);
  const existing = readDraftIntents(account).intents[operationKey];

  if (
    existing &&
    (existing.operationKey !== operationKey || existing.rfcMessageId !== rfcMessageId)
  ) {
    throw new Error(
      "The local Gmail draft retry state does not match this operation; no draft was created.",
    );
  }
  if (existing && existing.payloadDigest !== payloadDigest) {
    throw new Error("That Gmail draft operation id was already used with different recipients or content.");
  }
  const retryAction = gmailDraftRetryAction(existing);
  if (retryAction === "replay" && existing) return resultFromIntent(existing, account, true);
  if (retryAction === "recover-only" && existing) {
    const recovered = await recoverWithBoundedWait(gmail, rfcMessageId);
    if (recovered?.id) {
      return resultFromIntent(
        completeIntent(account, existing, { id: recovered.id, message: recovered.message }),
        account,
        true,
      );
    }
    throw new Error(
      "A previous Gmail draft request is still unresolved. Studio Assistant did not create another draft; check Gmail or retry this same tool call later.",
    );
  }

  const now = new Date().toISOString();
  const pending: DraftIntent = existing ?? {
    operationKey,
    payloadDigest,
    rfcMessageId,
    state: "pending",
    phase: "prepared",
    createdAt: now,
    updatedAt: now,
  };
  if (!existing) writeDraftIntent(account, pending);

  // A retry always searches before it mutates. This covers a prior process that
  // died after Gmail committed but before local completion was recorded.
  const recoveredBeforeCreate = await findDraftByMessageId(gmail, rfcMessageId);
  if (recoveredBeforeCreate?.id) {
    return resultFromIntent(
      completeIntent(account, pending, {
        id: recoveredBeforeCreate.id,
        message: recoveredBeforeCreate.message,
      }),
      account,
      true,
    );
  }

  const raw = await buildGmailRawMessage(draft, { messageId: rfcMessageId });
  const attempted: DraftIntent = {
    ...pending,
    phase: "attempted",
    updatedAt: new Date().toISOString(),
  };
  // This is the at-most-once boundary. A crash after this write is treated as
  // an ambiguous submission and future retries recover only; they do not send
  // a second create request.
  writeDraftIntent(account, attempted);
  let response: gmail_v1.Schema$Draft;
  try {
    const created = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw } },
    });
    response = created.data;
  } catch (error) {
    if (!ambiguousCreateError(error)) {
      // A definitive client/auth rejection did not commit a draft. Restore the
      // prepared phase so the same operation can be retried after correction.
      writeDraftIntent(account, {
        ...pending,
        phase: "prepared",
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
    const recovered = await recoverWithBoundedWait(gmail, rfcMessageId);
    if (recovered?.id) {
      return resultFromIntent(
        completeIntent(account, attempted, { id: recovered.id, message: recovered.message }),
        account,
        true,
      );
    }
    throw new Error(
      "Gmail did not confirm whether the draft was created. Retry the same tool call; Studio Assistant will search for the original before creating anything else.",
      { cause: error },
    );
  }

  if (response.id) {
    return resultFromIntent(
      completeIntent(account, attempted, {
        id: response.id,
        message: response.message,
      }),
      account,
      false,
    );
  }

  const recovered = await recoverWithBoundedWait(gmail, rfcMessageId);
  if (recovered?.id) {
    return resultFromIntent(
      completeIntent(account, attempted, { id: recovered.id, message: recovered.message }),
      account,
      true,
    );
  }
  throw new Error(
    "Gmail accepted the draft request but did not confirm its id. Retry the same tool call; Studio Assistant will recover it without creating another draft.",
  );
}

const draftOperationsInFlight = new Map<
  string,
  { payloadDigest: string; promise: Promise<GmailDraftResult> }
>();
const draftAccountTails = new Map<string, Promise<void>>();

function queueDraftForAccount<T>(accountKey: string, operation: () => Promise<T>) {
  // Draft intents share one account-scoped JSON file. Live can surface several
  // function calls at once, so serialize the read-modify-write lifecycle for
  // different draft operations as well as deduplicating the same operation.
  const tail = draftAccountTails.get(accountKey) ?? Promise.resolve();
  const result = tail.then(operation, operation);
  const nextTail = result.then(() => undefined, () => undefined);
  draftAccountTails.set(accountKey, nextTail);
  void nextTail.then(() => {
    if (draftAccountTails.get(accountKey) === nextTail) draftAccountTails.delete(accountKey);
  });
  return result;
}

/**
 * Create a real Gmail draft. This module intentionally exposes no send path:
 * reviewing the draft in Gmail remains the human approval boundary.
 */
export async function createGmailDraft(input: CreateGmailDraftInput): Promise<GmailDraftResult> {
  if (usesAgentGoogleConnectors()) return createConnectorGmailDraft(input);
  const operationId = requiredOperationId(input.operationId);
  const draft = validateGmailDraft(input);
  const auth = await getAuthorizedGoogleClient([GOOGLE_SCOPES.gmailCompose]);
  const gmail = google.gmail({ version: "v1", auth });
  const account = await resolveGmailAccount(gmail);
  const inFlightKey = `${account.accountKey}:${digest(operationId)}`;
  const inFlight = draftOperationsInFlight.get(inFlightKey);
  const payloadDigest = gmailDraftPayloadDigest(draft);
  if (inFlight) {
    if (inFlight.payloadDigest !== payloadDigest) {
      throw new Error("That Gmail draft operation id is already running with different recipients or content.");
    }
    return inFlight.promise;
  }

  const pending = queueDraftForAccount(account.accountKey, () =>
    executeDraftOperation(gmail, account, draft, operationId),
  );
  draftOperationsInFlight.set(inFlightKey, { payloadDigest, promise: pending });
  try {
    return await pending;
  } finally {
    if (draftOperationsInFlight.get(inFlightKey)?.promise === pending) {
      draftOperationsInFlight.delete(inFlightKey);
    }
  }
}
