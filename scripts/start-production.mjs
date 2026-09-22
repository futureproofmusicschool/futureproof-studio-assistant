import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { resolveProductionBuild } from "../desktop/production-build.mjs";
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app");
try {
  process.env.NODE_ENV = "production";
  process.env.STUDIO_NEXT_DIST_DIR = resolveProductionBuild(appDir);
  process.chdir(appDir);
  createRequire(import.meta.url)(path.join(appDir, "server.js"));
} catch (error) { console.error(error.message); process.exitCode = 1; }
