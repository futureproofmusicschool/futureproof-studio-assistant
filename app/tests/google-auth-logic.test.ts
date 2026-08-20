import assert from "node:assert/strict";
import test from "node:test";
import {
  googleAccountIdentitiesMatch,
  selectGoogleRefreshToken,
} from "../lib/google/auth-logic";

test("Google account matching treats subject as authoritative", () => {
  assert.equal(
    googleAccountIdentitiesMatch(
      { subject: "account-b", email: "same@example.com" },
      { subject: "account-a", email: "same@example.com" },
    ),
    false,
  );
  assert.equal(
    googleAccountIdentitiesMatch(
      { subject: "account-a", email: "new@example.com" },
      { subject: "account-a", email: "old@example.com" },
    ),
    true,
  );
});

test("Google account matching falls back to normalized email", () => {
  assert.equal(
    googleAccountIdentitiesMatch(
      { email: "Artist@Example.com" },
      { email: "artist@example.com" },
    ),
    true,
  );
  assert.equal(googleAccountIdentitiesMatch({ email: "artist@example.com" }, null), false);
});

test("refresh tokens are reused only for a verified same-account reconnect", () => {
  assert.equal(selectGoogleRefreshToken("new-token", "old-token", false), "new-token");
  assert.equal(selectGoogleRefreshToken(undefined, "old-token", true), "old-token");
  assert.equal(selectGoogleRefreshToken(undefined, "old-token", false), undefined);
});
