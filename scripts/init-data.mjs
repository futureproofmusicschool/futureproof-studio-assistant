#!/usr/bin/env node

/**
 * Create the external student-data directory, migrate any legacy repo-local
 * data without overwriting it, and leave ignored compatibility links behind.
 *
 * The app reads DATA_ROOT directly. Links exist only so Claude Code, Codex,
 * shell helpers, and people following older paths still find the same files.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveDataRoot() {
  const override = process.env.STUDIO_ASSISTANT_DATA_DIR?.trim();
  if (override) return path.resolve(override);
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Futureproof Studio Assistant");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Futureproof Studio Assistant");
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "futureproof-studio-assistant");
}

const DATA_ROOT = resolveDataRoot();

function repoPath(relative) {
  return path.join(REPO_ROOT, relative);
}

function dataPath(relative) {
  return path.join(DATA_ROOT, relative);
}

function ensureParent(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
}

function filesMatch(left, right) {
  const leftStat = fs.statSync(left);
  const rightStat = fs.statSync(right);
  return leftStat.size === rightStat.size && fs.readFileSync(left).equals(fs.readFileSync(right));
}

function conflictPath(target) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let candidate = `${target}.from-checkout-${stamp}`;
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = `${target}.from-checkout-${stamp}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function moveAcrossVolumes(source, target) {
  ensureParent(target);
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    fs.cpSync(source, target, { recursive: true, preserveTimestamps: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
}

function mergeWithoutOverwrite(source, target) {
  if (!fs.existsSync(source)) return;
  if (!fs.existsSync(target)) {
    moveAcrossVolumes(source, target);
    return;
  }

  const sourceStat = fs.statSync(source);
  const targetStat = fs.statSync(target);
  if (sourceStat.isDirectory() && targetStat.isDirectory()) {
    for (const entry of fs.readdirSync(source)) {
      mergeWithoutOverwrite(path.join(source, entry), path.join(target, entry));
    }
    if (fs.readdirSync(source).length === 0) fs.rmdirSync(source);
    return;
  }

  if (sourceStat.isFile() && targetStat.isFile() && filesMatch(source, target)) {
    fs.unlinkSync(source);
    return;
  }

  moveAcrossVolumes(source, conflictPath(target));
}

function ensureSymlink(linkPath, target) {
  ensureParent(linkPath);
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink() && path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath)) === target) return;
    if (stat.isSymbolicLink()) fs.unlinkSync(linkPath);
    else return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const type = fs.existsSync(target) && fs.statSync(target).isDirectory() ? "dir" : "file";
  fs.symlinkSync(target, linkPath, type);
}

function initializeFromExample(target, exampleRelative, fallback = "") {
  if (fs.existsSync(target)) return;
  ensureParent(target);
  if (exampleRelative) {
    fs.cpSync(repoPath(exampleRelative), target, { recursive: true, preserveTimestamps: true });
  } else if (fallback !== null) {
    fs.writeFileSync(target, fallback, "utf8");
  }
}

function migrateLinkedFile(relative, exampleRelative = null, fallback = null) {
  const source = repoPath(relative);
  const target = dataPath(relative);
  if (fs.existsSync(source) && !fs.lstatSync(source).isSymbolicLink()) mergeWithoutOverwrite(source, target);
  initializeFromExample(target, exampleRelative, fallback);
  if (fs.existsSync(target)) ensureSymlink(source, target);
}

function migrateLinkedDirectory(relative, exampleRelative = null) {
  const source = repoPath(relative);
  const target = dataPath(relative);
  if (fs.existsSync(source) && !fs.lstatSync(source).isSymbolicLink()) mergeWithoutOverwrite(source, target);
  if (!fs.existsSync(target)) {
    if (exampleRelative) initializeFromExample(target, exampleRelative, null);
    else fs.mkdirSync(target, { recursive: true });
  }
  ensureSymlink(source, target);
}

function migrateMixedDirectory(relative, publicNames) {
  const source = repoPath(relative);
  const target = dataPath(relative);
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(target, { recursive: true });

  for (const entry of fs.readdirSync(source)) {
    if (publicNames.has(entry)) continue;
    const sourceEntry = path.join(source, entry);
    if (fs.lstatSync(sourceEntry).isSymbolicLink()) continue;
    mergeWithoutOverwrite(sourceEntry, path.join(target, entry));
  }

  for (const entry of fs.readdirSync(target)) {
    const link = path.join(source, entry);
    if (!fs.existsSync(link)) ensureSymlink(link, path.join(target, entry));
  }
}

function migrateLocalRules() {
  const source = repoPath(path.join(".claude", "rules"));
  const target = dataPath(path.join(".claude", "rules"));
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(target, { recursive: true });

  for (const entry of fs.readdirSync(source)) {
    if (entry !== "studio-context.md" && !entry.endsWith(".local.md")) continue;
    const sourceEntry = path.join(source, entry);
    if (!fs.lstatSync(sourceEntry).isSymbolicLink()) mergeWithoutOverwrite(sourceEntry, path.join(target, entry));
  }

  initializeFromExample(path.join(target, "studio-context.md"), "examples/studio-context.md");
  for (const entry of fs.readdirSync(target)) {
    if (entry === "studio-context.md" || entry.endsWith(".local.md")) {
      ensureSymlink(path.join(source, entry), path.join(target, entry));
    }
  }
}

fs.mkdirSync(DATA_ROOT, { recursive: true });
try {
  fs.chmodSync(DATA_ROOT, 0o700);
} catch {
  // Some filesystems (notably Windows) do not expose Unix permission bits.
}

migrateLinkedFile("assistant.json", "examples/assistant.json");
migrateLinkedFile("settings.json");
migrateLinkedFile("ableton-hosts.json");
migrateLinkedFile(".env", null, "GEMINI_API_KEY=\n");
migrateLinkedFile("CLAUDE.local.md", "examples/CLAUDE.local.md");
migrateLinkedFile(".git-personal-terms", null, "# One private term per line. Staged additions are checked case-insensitively.\n");
migrateLinkedFile(path.join("board", "board.json"), "examples/board.json");
migrateLinkedFile(path.join("contacts", "contacts.json"), "examples/contacts.json");
migrateLinkedFile(path.join("voice", "prompt.md"), "examples/prompt.md");

migrateLinkedDirectory("memory", "examples/memory");
migrateLinkedDirectory("plans");
migrateLinkedDirectory(path.join("voice", "transcripts"));
migrateLinkedDirectory(path.join(".claude", "skills"));

migrateLocalRules();
migrateMixedDirectory("outbox", new Set(["README.md"]));
migrateMixedDirectory("instruments", new Set(["README.md", "example-percussion.md"]));
migrateMixedDirectory("reference", new Set(["README.md"]));

console.log(`student data: ${DATA_ROOT}`);
