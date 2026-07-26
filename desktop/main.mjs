// Electron shell for the studio assistant. The Next server (app/server.js,
// port 3017) stays the only real backend: if it's already running (dev
// workflow, or another window), this window just attaches; otherwise it is
// spawned as a child and stopped again when the app quits. The renderer is the
// same web app a browser sees, so contextIsolation/sandbox stay on and there
// is no preload surface at all.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, session, shell } from "electron";

const PORT = Number(process.env.PORT || 3017);
const APP_URL = `http://localhost:${PORT}/talk`;
const APP_ORIGIN = `http://localhost:${PORT}`;
const STARTUP_TIMEOUT_MS = 90_000; // first dev compile can be slow
const REPO_CONFIG_PATH = path.join(os.homedir(), ".studio-assistant-desktop.json");

let serverProcess = null;

// Running from the repo (npm start in desktop/) the server sits next door;
// the packaged .app instead reads the repo location from
// ~/.studio-assistant-desktop.json: {"repo": "/path/to/your/checkout"}.
function resolveServerDir() {
  const local = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app");
  if (fs.existsSync(path.join(local, "server.js"))) return local;

  try {
    const config = JSON.parse(fs.readFileSync(REPO_CONFIG_PATH, "utf8"));
    const fromConfig = path.join(String(config.repo || ""), "app");
    if (fs.existsSync(path.join(fromConfig, "server.js"))) return fromConfig;
  } catch {
    // Fall through to the error below.
  }
  return null;
}

function portAnswering() {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1500 }, (response) => {
      response.resume();
      resolve(true);
    });
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function ensureServer() {
  if (await portAnswering()) return;

  const serverDir = resolveServerDir();
  if (!serverDir) {
    throw new Error(
      `Can't find the studio assistant repo. Point ${REPO_CONFIG_PATH} at it: {"repo": "/path/to/checkout"}`,
    );
  }

  // Electron doubles as the Node runtime, so a GUI launch (no shell PATH,
  // possibly no system node) still works. Server output lands in
  // ~/Library/Logs/studio-assistant-desktop.log for diagnosing GUI launches.
  const logPath = path.join(os.homedir(), "Library", "Logs", "studio-assistant-desktop.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, "a");
  fs.writeSync(logFd, `\n--- launch ${new Date().toISOString()} from ${serverDir} ---\n`);

  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: serverDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(PORT) },
    stdio: ["ignore", logFd, logFd],
    detached: false,
  });
  serverProcess.on("exit", () => {
    serverProcess = null;
  });

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await portAnswering()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The app server did not answer on port ${PORT}.`);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    title: "TEO",
    backgroundColor: "#111114",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // The window is for the local app only; anything else opens in the browser.
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_ORIGIN)) void shell.openExternal(url);
    return { action: "deny" };
  });

  void window.loadURL(APP_URL);
  return window;
}

app.whenReady().then(async () => {
  // The Talk tab needs the microphone; nothing else gets a permission.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const fromApp = webContents.getURL().startsWith(APP_ORIGIN);
    callback(fromApp && (permission === "media" || permission === "audioCapture"));
  });

  try {
    await ensureServer();
  } catch (error) {
    dialog.showErrorBox("TEO", `${error.message}\n\nStart it by hand with: npm run dev --prefix app`);
    app.quit();
    return;
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("quit", () => {
  // Only stop the server if this shell started it; a dev server someone ran
  // in a terminal is theirs, not ours.
  if (serverProcess) serverProcess.kill();
});
