import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** Hash only public runtime inputs, never private state or dependency contents. */
export function sourceFingerprint(appDir) {
  const digest = crypto.createHash("sha256");
  function visit(relative) {
    const absolute = path.join(appDir, relative);
    if (!fs.existsSync(absolute)) return;
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(path.join(relative, name));
    } else { digest.update(relative); digest.update(fs.readFileSync(absolute)); }
  }
  for (const entry of ["app", "components", "hooks", "lib", "public", "server.js", "next.config.mjs", "tsconfig.json", "package.json", "package-lock.json"]) visit(entry);
  return digest.digest("hex");
}
export function resolveProductionBuild(appDir) {
  let marker;
  try { marker = JSON.parse(fs.readFileSync(path.join(appDir, ".studio-builds", "current.json"), "utf8")); }
  catch { throw new Error("No production build is available. Run npm run build --prefix app, then launch again."); }
  if (!/^\.studio-builds\/[a-f0-9-]+$/.test(marker.distDir) || marker.fingerprint !== sourceFingerprint(appDir) || !fs.existsSync(path.join(appDir, marker.distDir, "BUILD_ID"))) {
    throw new Error("The production build is out of date. Run npm run build --prefix app, then launch again.");
  }
  return marker.distDir;
}
