import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { REPO_ROOT } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const run = promisify(execFile);
const INSTALL_SCRIPT = path.join(REPO_ROOT, "scripts", "install-abletonosc.sh");
const INSTALL_DIRECTORY = path.join(
  os.homedir(),
  "Music",
  "Ableton",
  "User Library",
  "Remote Scripts",
  "AbletonOSC",
);
const ACTION_HEADER = "install-abletonosc";

let installationRunning = false;

function state() {
  return {
    supported: process.platform === "darwin",
    installed: fs.existsSync(path.join(INSTALL_DIRECTORY, "__init__.py")),
  };
}

export async function GET() {
  return NextResponse.json(state());
}

export async function POST(request: Request) {
  if (request.headers.get("x-studio-assistant-action") !== ACTION_HEADER) {
    return NextResponse.json({ error: "Installation confirmation is missing." }, { status: 400 });
  }
  if (process.platform !== "darwin") {
    return NextResponse.json({ error: "The in-app installer currently supports macOS only." }, { status: 400 });
  }
  if (installationRunning) {
    return NextResponse.json({ error: "AbletonOSC installation is already running." }, { status: 409 });
  }
  if (!fs.existsSync(INSTALL_SCRIPT)) {
    return NextResponse.json({ error: "The bundled AbletonOSC installer could not be found." }, { status: 500 });
  }

  installationRunning = true;
  try {
    const { stderr } = await run(INSTALL_SCRIPT, [], {
      cwd: REPO_ROOT,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });

    if (!state().installed) {
      throw new Error(stderr.trim() || "The installer finished, but AbletonOSC was not found in the User Library.");
    }

    return NextResponse.json({ ...state(), message: "AbletonOSC is installed on this Mac." });
  } catch (error) {
    const details =
      error instanceof Error && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : error instanceof Error
          ? error.message
          : "AbletonOSC installation failed.";
    return NextResponse.json({ error: details.slice(0, 500) }, { status: 500 });
  } finally {
    installationRunning = false;
  }
}
