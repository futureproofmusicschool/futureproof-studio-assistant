import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sourceFingerprint, resolveProductionBuild } from "../../desktop/production-build.mjs";

test("launcher rejects missing and stale production builds without touching a current build", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-build-test-"));
  try {
    assert.throws(() => resolveProductionBuild(root), /No production build/);
    fs.mkdirSync(path.join(root, "app"));
    fs.writeFileSync(path.join(root, "app", "page.tsx"), "export default function Page() { return null; }");
    const distDir = ".studio-builds/abc-123";
    fs.mkdirSync(path.join(root, distDir), { recursive: true });
    fs.writeFileSync(path.join(root, distDir, "BUILD_ID"), "example-build");
    fs.writeFileSync(path.join(root, ".studio-builds", "current.json"), JSON.stringify({ distDir, fingerprint: sourceFingerprint(root) }));
    assert.equal(resolveProductionBuild(root), distDir);
    fs.writeFileSync(path.join(root, "app", "page.tsx"), "export default function Page() { return 'Changed'; }");
    assert.throws(() => resolveProductionBuild(root), /out of date/);
    assert.equal(fs.readFileSync(path.join(root, distDir, "BUILD_ID"), "utf8"), "example-build");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
