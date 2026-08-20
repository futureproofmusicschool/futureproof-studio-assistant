import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_CONTACT_INTENT_SYNC_WINDOW_MS,
  isStaleGoogleContactIntent,
} from "../lib/contact-retry";

const createdAt = "2026-08-15T12:00:00.000Z";
const createdMilliseconds = Date.parse(createdAt);

test("Google Contact create intents stay protected throughout the sync window", () => {
  assert.equal(
    isStaleGoogleContactIntent(
      createdAt,
      createdMilliseconds + GOOGLE_CONTACT_INTENT_SYNC_WINDOW_MS - 1,
    ),
    false,
  );
});

test("Google Contact create intents expire at the bounded recovery threshold", () => {
  assert.equal(
    isStaleGoogleContactIntent(
      createdAt,
      createdMilliseconds + GOOGLE_CONTACT_INTENT_SYNC_WINDOW_MS,
    ),
    true,
  );
  assert.equal(isStaleGoogleContactIntent("not-a-date", createdMilliseconds), false);
});
