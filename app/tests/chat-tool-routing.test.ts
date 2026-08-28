import assert from "node:assert/strict";
import test from "node:test";
import {
  chatProgressMessage,
  parseCapabilityCategory,
  planChatTools,
  toolNamesForCategories,
} from "../lib/chat-tool-routing";

test("ordinary conversation starts without the full tool catalog", () => {
  const categories = planChatTools("What do you think of this arrangement idea?");
  assert.deepEqual(Array.from(categories), []);
  assert.equal(toolNamesForCategories(categories).size, 0);
  assert.equal(chatProgressMessage(categories), "Got it — I’m thinking through that now.");
});

test("general Ableton advice does not imply control of the live session", () => {
  assert.deepEqual(Array.from(planChatTools("What compressor should I use in Ableton?")), []);
  assert.deepEqual(Array.from(planChatTools("Recommend an effects chain for my track in Ableton.")), []);
});

test("an explicit Ableton session request exposes the Ableton family", () => {
  const categories = planChatTools("Check my current Ableton session and show the selected track.");
  assert.deepEqual(Array.from(categories), ["ableton"]);
  assert.ok(toolNamesForCategories(categories).has("get_live_overview"));
  assert.ok(toolNamesForCategories(categories).has("compose_midi_part"));
});

test("document and outreach intents expose only their relevant families", () => {
  const categories = planChatTools("Draft an email to that contact and save it in a Google Doc.");
  assert.deepEqual(Array.from(categories), ["documents", "contacts"]);
  const names = toolNamesForCategories(categories);
  assert.ok(names.has("write_document"));
  assert.ok(names.has("draft_email"));
  assert.equal(names.has("get_live_overview"), false);
});

test("the capability broker accepts only known categories", () => {
  assert.equal(parseCapabilityCategory("reference"), "reference");
  assert.equal(parseCapabilityCategory("web"), "web");
  assert.equal(parseCapabilityCategory("everything"), null);
});
