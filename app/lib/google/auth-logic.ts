export type GoogleAccountIdentity = {
  subject?: string | null;
  email?: string | null;
};

/** Subject is authoritative when both sides have one; email is the fallback. */
export function googleAccountIdentitiesMatch(
  left: GoogleAccountIdentity | null | undefined,
  right: GoogleAccountIdentity | null | undefined,
) {
  if (!left || !right) return false;
  if (left.subject && right.subject) return left.subject === right.subject;
  if (left.email && right.email) {
    return left.email.trim().toLowerCase() === right.email.trim().toLowerCase();
  }
  return false;
}

/** Never carry a long-lived credential across an unverified account switch. */
export function selectGoogleRefreshToken(
  received: string | null | undefined,
  prior: string | null | undefined,
  sameAccount: boolean,
) {
  if (received) return received;
  return sameAccount && prior ? prior : undefined;
}
