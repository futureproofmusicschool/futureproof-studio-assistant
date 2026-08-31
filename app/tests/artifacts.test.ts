import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeArtifact } from "../lib/artifacts";

test("local artifacts are written privately under the supplied artifacts root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-artifacts-"));
  try {
    const written = writeArtifact(
      { path: "practice/indian-rudiments.html", content: "<!doctype html><title>Practice</title>" },
      root,
    );

    assert.equal(written.path, "artifacts/practice/indian-rudiments.html");
    assert.equal(fs.readFileSync(path.join(root, "practice", "indian-rudiments.html"), "utf8"), "<!doctype html><title>Practice</title>");
    assert.equal(fs.statSync(written.absolutePath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("local artifact writes reject traversal and protect existing content", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-artifacts-"));
  try {
    assert.throws(() => writeArtifact({ path: "../escape.html", content: "no" }, root), /cannot contain/);
    writeArtifact({ path: "page.html", content: "first" }, root);
    assert.throws(() => writeArtifact({ path: "page.html", content: "second" }, root), /already exists/);
    const replaced = writeArtifact({ path: "page.html", content: "second", overwrite: true }, root);
    assert.equal(replaced.overwritten, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
