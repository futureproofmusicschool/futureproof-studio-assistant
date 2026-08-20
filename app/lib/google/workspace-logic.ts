import { createHash } from "node:crypto";

export type GoogleWorkspaceIdentity = {
  subject?: string | null;
  email?: string | null;
};

/**
 * Drive appProperties must distinguish two people using the same public OAuth
 * client. Keep the raw Google identity out of Drive metadata while retaining a
 * deterministic value that another installation connected to the same account
 * can rediscover.
 */
export function googleWorkspaceAccountTag(identity: GoogleWorkspaceIdentity) {
  const subject = identity.subject?.trim();
  const email = identity.email?.trim().toLowerCase();
  const canonical = subject ? `subject:${subject}` : email ? `email:${email}` : "";
  if (!canonical) throw new Error("Google did not identify the connected account.");
  return `a_${createHash("sha256").update(canonical).digest("hex")}`;
}

export function googleCreateWasDefinitelyRejected(error: unknown) {
  const value = error as { code?: unknown; response?: { status?: unknown } };
  const status = Number(value?.code ?? value?.response?.status);
  return Number.isInteger(status) && status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}
