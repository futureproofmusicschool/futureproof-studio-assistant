export const GOOGLE_CONTACT_INTENT_SYNC_WINDOW_MS = 5 * 60_000;

export function isStaleGoogleContactIntent(createdAt: string, nowMilliseconds = Date.now()) {
  const createdMilliseconds = Date.parse(createdAt);
  return (
    !Number.isNaN(createdMilliseconds) &&
    nowMilliseconds >= createdMilliseconds + GOOGLE_CONTACT_INTENT_SYNC_WINDOW_MS
  );
}
