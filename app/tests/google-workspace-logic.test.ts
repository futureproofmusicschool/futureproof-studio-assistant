import assert from "node:assert/strict";
import test from "node:test";
import {
  googleCreateWasDefinitelyRejected,
  googleWorkspaceAccountTag,
} from "../lib/google/workspace-logic";

test("workspace account tags prefer the stable Google subject", () => {
  assert.equal(
    googleWorkspaceAccountTag({ subject: "google-subject", email: "first@example.com" }),
    googleWorkspaceAccountTag({ subject: "google-subject", email: "renamed@example.com" }),
  );
  assert.notEqual(
    googleWorkspaceAccountTag({ subject: "another-subject", email: "first@example.com" }),
    googleWorkspaceAccountTag({ subject: "google-subject", email: "first@example.com" }),
  );
});

test("workspace account tags normalize fallback email without exposing it", () => {
  const lower = googleWorkspaceAccountTag({ email: "artist@example.com" });
  assert.equal(lower, googleWorkspaceAccountTag({ email: " Artist@Example.COM " }));
  assert.match(lower, /^a_[a-f0-9]{64}$/);
  assert.equal(lower.includes("artist"), false);
  assert.throws(() => googleWorkspaceAccountTag({}), /did not identify/);
});

test("only definitive client errors clear a pending Drive create", () => {
  assert.equal(googleCreateWasDefinitelyRejected({ code: 400 }), true);
  assert.equal(googleCreateWasDefinitelyRejected({ response: { status: 403 } }), true);
  assert.equal(googleCreateWasDefinitelyRejected({ code: 408 }), false);
  assert.equal(googleCreateWasDefinitelyRejected({ code: 429 }), false);
  assert.equal(googleCreateWasDefinitelyRejected({ code: 500 }), false);
  assert.equal(googleCreateWasDefinitelyRejected(new Error("network")), false);
});
