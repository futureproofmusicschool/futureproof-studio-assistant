export type PendingDocumentMarkerState = "absent" | "match" | "conflict";
export type PendingDocumentWriteAction = "write" | "complete" | "conflict";

function comparablePlainText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n+$/, "");
}

/**
 * Decide whether a pending create/import can write, can safely finish its
 * metadata, or must stop to protect a Google-side edit.
 *
 * A matching marker proves the earlier body batch committed atomically. Older
 * pending files have no marker, so exact content is also accepted. A blank
 * document is writable only in the invocation that just created it.
 */
export function pendingDocumentWriteAction(input: {
  marker: PendingDocumentMarkerState;
  currentPlainText: string;
  intendedPlainText: string;
  allowBlankWrite: boolean;
  currentTitle?: string;
  intendedTitle?: string;
}): PendingDocumentWriteAction {
  if (input.marker === "conflict") return "conflict";
  if (
    input.currentTitle !== undefined &&
    input.intendedTitle !== undefined &&
    input.currentTitle !== input.intendedTitle
  ) {
    return "conflict";
  }
  const current = comparablePlainText(input.currentPlainText);
  const intended = comparablePlainText(input.intendedPlainText);
  if (current === intended) return "complete";
  if (input.marker === "match") return "conflict";
  if (!current && input.allowBlankWrite) return "write";
  return "conflict";
}
