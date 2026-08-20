export type GmailDraftRetryRecord = {
  state: "pending" | "complete";
  /** Missing on legacy pending files, which must be treated conservatively. */
  phase?: "prepared" | "attempted";
};

export type GmailDraftRetryAction = "create" | "recover-only" | "replay";

/**
 * A fresh/prepared intent may issue its one create request. Once an attempt
 * may have crossed the network, retries only recover by Message-ID; they never
 * risk a second create because Gmail offers no idempotency key for drafts.
 */
export function gmailDraftRetryAction(
  record: GmailDraftRetryRecord | undefined,
): GmailDraftRetryAction {
  if (!record) return "create";
  if (record.state === "complete") return "replay";
  return record.phase === "prepared" ? "create" : "recover-only";
}
