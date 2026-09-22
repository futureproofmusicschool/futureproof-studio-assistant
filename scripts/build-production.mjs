import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { sourceFingerprint } from "../desktop/production-build.mjs";
import files from "../app/lib/runtime/files.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "app");
const fingerprint = sourceFingerprint(appDir);
const distDir = `.studio-builds/${fingerprint.slice(0, 16)}-${crypto.randomUUID()}`;
const buildConfig = `${distDir}.tsconfig.json`;
files.writeJson(path.join(appDir, buildConfig), {
  extends: "../tsconfig.json",
  compilerOptions: { baseUrl: "..", incremental: false },
  include: ["../next-env.d.ts", ...["app", "components", "hooks", "lib", "tests", "types"].flatMap((dir) => [`../${dir}/**/*.ts`, `../${dir}/**/*.tsx`]), `${path.basename(distDir)}/types/**/*.ts`],
  exclude: ["../node_modules"],
});
const nextEnvPath = path.join(appDir, "next-env.d.ts");
const nextEnv = fs.readFileSync(nextEnvPath, "utf8");
const child = spawn(process.execPath, [path.join(appDir, "node_modules", "next", "dist", "bin", "next"), "build"], {
  cwd: appDir, stdio: "inherit", env: { ...process.env, NODE_ENV: "production", STUDIO_NEXT_DIST_DIR: distDir, STUDIO_TSCONFIG: buildConfig },
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => {
  fs.writeFileSync(nextEnvPath, nextEnv);
  if (code !== 0) { process.exitCode = code ?? 1; return; }
  if (sourceFingerprint(appDir) !== fingerprint) { console.error("Sources changed during build; build again before launching."); process.exitCode = 1; return; }
  // Updating the pointer cannot alter files used by an already-running server.
  files.writeJson(path.join(appDir, ".studio-builds", "current.json"), { fingerprint, distDir });
});
