import fs from "node:fs";
import path from "node:path";
import { dataPath } from "@/lib/paths";

const ARTIFACTS_DIRECTORY = "artifacts";
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".md",
  ".svg",
  ".txt",
]);

export type WriteArtifactInput = {
  path: string;
  content: string;
  overwrite?: boolean;
};

export type WrittenArtifact = {
  path: string;
  absolutePath: string;
  bytes: number;
  overwritten: boolean;
  unchanged: boolean;
};

function normalizeArtifactPath(requested: string) {
  const raw = requested.trim().replaceAll("\\", "/");
  if (!raw || path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) {
    throw new Error("Use a relative filename inside artifacts/, not an absolute path.");
  }

  const relative = raw.startsWith(`${ARTIFACTS_DIRECTORY}/`)
    ? raw.slice(ARTIFACTS_DIRECTORY.length + 1)
    : raw;
  const segments = relative.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith(".") ||
        segment.length > 120,
    )
  ) {
    throw new Error("Artifact paths cannot contain hidden, empty, dot, or overlong path segments.");
  }

  const extension = path.extname(segments.at(-1) ?? "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(
      `That artifact type is not allowed. Use one of: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}.`,
    );
  }

  return segments;
}

function ensurePrivateDirectory(directory: string) {
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("The local artifacts path is not a safe directory.");
    }
    return;
  }
  fs.mkdirSync(directory, { mode: 0o700 });
}

/**
 * Write a user-owned artifact under the external data root. The path is
 * intentionally narrower than the read tools: model-created files never land
 * in the public checkout, memory, settings, or credentials.
 */
export function writeArtifact(
  input: WriteArtifactInput,
  artifactsRoot = dataPath(ARTIFACTS_DIRECTORY),
): WrittenArtifact {
  const segments = normalizeArtifactPath(input.path);
  const content = typeof input.content === "string" ? input.content : "";
  const bytes = Buffer.byteLength(content, "utf8");
  if (!content) throw new Error("write_studio_file needs file content.");
  if (bytes > MAX_ARTIFACT_BYTES) {
    throw new Error(`The local artifact is too large (${bytes} bytes; maximum ${MAX_ARTIFACT_BYTES}).`);
  }

  ensurePrivateDirectory(artifactsRoot);
  let parent = artifactsRoot;
  for (const segment of segments.slice(0, -1)) {
    parent = path.join(parent, segment);
    ensurePrivateDirectory(parent);
  }

  const target = path.join(parent, segments.at(-1)!);
  let existed = false;
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("The requested artifact path is not a safe regular file.");
    }
    existed = true;
    if (fs.readFileSync(target, "utf8") === content) {
      return {
        path: `${ARTIFACTS_DIRECTORY}/${segments.join("/")}`,
        absolutePath: target,
        bytes,
        overwritten: false,
        unchanged: true,
      };
    }
    if (!input.overwrite) {
      throw new Error("That local artifact already exists. Set overwrite to true only if the artist asked to replace it.");
    }
  }

  const temporary = path.join(parent, `.${segments.at(-1)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }

  return {
    path: `${ARTIFACTS_DIRECTORY}/${segments.join("/")}`,
    absolutePath: target,
    bytes,
    overwritten: existed,
    unchanged: false,
  };
}
