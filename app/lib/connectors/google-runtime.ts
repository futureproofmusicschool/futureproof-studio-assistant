import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CodexAppServerClient,
  type CodexAppDescriptor,
  type CodexMcpToolDescriptor,
  type JsonObject,
} from "@/lib/connectors/codex-app-server";
import {
  CLAUDE_CONNECTORS_INSTALL_URL,
  inspectClaudeCodeConnectors,
  invokeClaudeConnectorOperation,
  mcpServerToolPrefix,
  type ClaudeCodeConnectorInspection,
  type ClaudeConnectorKind,
} from "@/lib/connectors/claude-code";
import { getGoogleConnectionStatus } from "@/lib/google/auth";
import { readSettings, type ConnectorHost } from "@/lib/settings";
import type { AgentConnectorHost } from "@/lib/connectors/state";

export type GoogleConnectorApp = "drive" | "gmail";

export type ConnectorAppStatus = {
  available: boolean;
  connected: boolean;
  installUrl?: string;
};

export type GoogleConnectorStatus = {
  selectedHost: ConnectorHost;
  effectiveHost: Exclude<ConnectorHost, "auto"> | null;
  status: "ready" | "needs_host" | "needs_sign_in" | "needs_connectors" | "unavailable" | "error";
  hosts: {
    codex: { available: boolean };
    claude: { available: boolean };
    directGoogle: { available: boolean };
  };
  apps: {
    drive: ConnectorAppStatus;
    gmail: ConnectorAppStatus;
  };
  message?: string;
};

const DRIVE_TOOLS = [
  "google_drive_get_profile",
  "google_drive_list_folder",
  "google_drive_create_folder",
  "google_drive_create_file",
  "google_drive_update_file",
  "google_drive_get_file_metadata",
  "google_drive_get_document",
  "google_drive_batch_update_document",
  "google_drive_get_spreadsheet_metadata",
  "google_drive_get_spreadsheet_range",
  "google_drive_batch_update_spreadsheet",
] as const;
const GMAIL_TOOLS = ["gmail_get_profile", "gmail_create_draft"] as const;
const SAFE_TOOLS = [...DRIVE_TOOLS, ...GMAIL_TOOLS] as const;
const CODEX_SERVER = "codex_apps";
const CODEX_INSTALL_URL = "https://chatgpt.com/apps";
const STATUS_CACHE_MS = 10_000;

type CodexInspection = {
  available: boolean;
  signedIn: boolean;
  apps: { drive: ConnectorAppStatus; gmail: ConnectorAppStatus };
  tools: CodexMcpToolDescriptor[];
  error?: string;
};

type RuntimeCache = {
  codexClient: Promise<CodexAppServerClient> | null;
  codexToolTail: Promise<unknown>;
  codexTools: { expiresAt: number; tools: CodexMcpToolDescriptor[] } | null;
  claudeToolTail: Promise<unknown>;
  status: { expiresAt: number; value: Promise<GoogleConnectorStatus> } | null;
  lastStatus: GoogleConnectorStatus | null;
};

const runtimeGlobal = globalThis as typeof globalThis & { __studioGoogleConnectorRuntime?: RuntimeCache };
const runtime = runtimeGlobal.__studioGoogleConnectorRuntime ??= {
  codexClient: null,
  codexToolTail: Promise.resolve(),
  codexTools: null,
  claudeToolTail: Promise.resolve(),
  status: null,
  lastStatus: null,
};
runtime.codexToolTail ??= Promise.resolve();
runtime.codexTools ??= null;
runtime.claudeToolTail ??= Promise.resolve();

function exactCodexPermissions() {
  return SAFE_TOOLS.flatMap((tool) => providerToolNames(tool).flatMap((providerTool) => [
    { server: CODEX_SERVER, tool: providerTool },
    { server: CODEX_SERVER, tool: `mcp__${CODEX_SERVER}__${providerTool}` },
  ]));
}

function codexExecutable() {
  const names = process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"];
  const pathDirectories = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const directories = Array.from(new Set([
    ...pathDirectories,
    path.join(os.homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]));
  for (const directory of directories) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Continue through the bounded executable locations.
      }
    }
  }
  return "codex";
}

function providerToolNames(name: string) {
  if (name.startsWith("google_drive_")) return [name, `google_drive.${name.slice("google_drive_".length)}`];
  if (name.startsWith("gmail_")) return [name, `gmail.${name.slice("gmail_".length)}`];
  return [name];
}

async function createCodexClient() {
  const client = await CodexAppServerClient.connect({
    command: codexExecutable(),
    cwd: process.cwd(),
    startupTimeoutMs: 15_000,
    requestTimeoutMs: 60_000,
    turnTimeoutMs: 120_000,
    allowedMcpTools: exactCodexPermissions(),
    clientInfo: { name: "futureproof-studio-assistant", title: "Futureproof Studio Assistant", version: "1" },
  });
  await client.startDedicatedThread({
    cwd: process.cwd(),
    ephemeral: true,
    serviceName: "Futureproof Studio Assistant Google connectors",
  });
  runtime.codexTools = null;
  return client;
}

async function codexClient() {
  const existing = runtime.codexClient;
  if (existing) {
    try {
      const client = await existing;
      if (client.getCapabilities().connectionState === "ready") return client;
    } catch {
      // Replace a failed process below.
    }
    runtime.codexClient = null;
  }
  const pending = createCodexClient();
  runtime.codexClient = pending;
  try {
    return await pending;
  } catch (error) {
    if (runtime.codexClient === pending) runtime.codexClient = null;
    throw error;
  }
}

function appDescriptor(apps: CodexAppDescriptor[], app: GoogleConnectorApp) {
  const expression = app === "drive" ? /google\s*drive|google-drive/i : /gmail/i;
  return apps.find((candidate) => expression.test(`${candidate.id} ${candidate.name}`));
}

function toolMatches(tool: CodexMcpToolDescriptor, name: string) {
  return tool.server === CODEX_SERVER && providerToolNames(name).some((providerName) =>
    tool.name === providerName ||
    tool.name === `mcp__${CODEX_SERVER}__${providerName}` ||
    tool.name.endsWith(`__${providerName}`));
}

async function inspectCodex(): Promise<CodexInspection> {
  try {
    const inspect = async () => {
      const client = await codexClient();
      const apps = await client.discoverApps();
      const inventory = await client.discoverTools();
      return { apps, inventory };
    };
    const pending = runtime.codexToolTail.then(inspect, inspect);
    runtime.codexToolTail = pending.then(() => undefined, () => undefined);
    const { apps, inventory } = await pending;
    runtime.codexTools = { expiresAt: Date.now() + 5 * 60_000, tools: inventory.tools };
    const driveApp = appDescriptor(apps, "drive");
    const gmailApp = appDescriptor(apps, "gmail");
    const driveConnected = DRIVE_TOOLS.every((name) => inventory.tools.some((tool) => toolMatches(tool, name)));
    const gmailConnected = GMAIL_TOOLS.every((name) => inventory.tools.some((tool) => toolMatches(tool, name)));
    const signedIn = inventory.servers.some((server) =>
      server.name === CODEX_SERVER && server.authStatus !== "notLoggedIn" && server.authStatus !== "unknown");
    const statusFor = (descriptor: CodexAppDescriptor | undefined, connected: boolean): ConnectorAppStatus => ({
      available: Boolean(descriptor) || connected,
      connected,
      installUrl: descriptor?.installUrl ?? CODEX_INSTALL_URL,
    });
    return {
      available: true,
      signedIn,
      apps: {
        drive: statusFor(driveApp, driveConnected),
        gmail: statusFor(gmailApp, gmailConnected),
      },
      tools: inventory.tools,
    };
  } catch (error) {
    return {
      available: false,
      signedIn: false,
      apps: {
        drive: { available: false, connected: false, installUrl: CODEX_INSTALL_URL },
        gmail: { available: false, connected: false, installUrl: CODEX_INSTALL_URL },
      },
      tools: [],
      error: error instanceof Error ? error.message : "Codex connector inspection failed.",
    };
  }
}

function claudeAppStatus(inspection: ClaudeCodeConnectorInspection, kind: ClaudeConnectorKind): ConnectorAppStatus {
  const connector = inspection.connectors[kind];
  return {
    available: Boolean(connector) || inspection.available,
    connected: Boolean(connector?.connected),
    installUrl: inspection.installUrl || CLAUDE_CONNECTORS_INSTALL_URL,
  };
}

function appForHost(
  host: AgentConnectorHost,
  codex: CodexInspection,
  claude: ClaudeCodeConnectorInspection,
) {
  return host === "codex"
    ? codex.apps
    : {
        drive: claudeAppStatus(claude, "google-drive"),
        gmail: claudeAppStatus(claude, "gmail"),
      };
}

function hostAvailable(host: AgentConnectorHost, codex: CodexInspection, claude: ClaudeCodeConnectorInspection) {
  return host === "codex" ? codex.available : claude.available;
}

function hostSignedIn(host: AgentConnectorHost, codex: CodexInspection, claude: ClaudeCodeConnectorInspection) {
  return host === "codex"
    ? codex.signedIn
    : claude.authentication !== "not-authenticated" && claude.authentication !== "unsupported-provider";
}

async function inspectStatusUncached(): Promise<GoogleConnectorStatus> {
  const selectedHost = readSettings().connectors.host;
  const direct = getGoogleConnectionStatus();
  const [codex, claude] = await Promise.all([
    inspectCodex(),
    inspectClaudeCodeConnectors({ cwd: process.cwd() }),
  ]);
  const hosts = {
    codex: { available: codex.available },
    claude: { available: claude.available },
    directGoogle: { available: direct.configured },
  };

  if (selectedHost === "direct-google") {
    const drive = Boolean(direct.connected && direct.services.drive);
    const gmail = Boolean(direct.connected && direct.services.gmail);
    return {
      selectedHost,
      effectiveHost: "direct-google",
      status: drive ? "ready" : direct.configured ? "needs_sign_in" : "needs_connectors",
      hosts,
      apps: {
        drive: { available: direct.configured, connected: drive, installUrl: "/api/google/auth/start" },
        gmail: { available: direct.configured, connected: gmail, installUrl: "/api/google/auth/start" },
      },
      message: drive
        ? "Using the advanced direct Google connection. Gmail remains draft-only."
        : "Configure the advanced OAuth client below, then connect Google.",
    };
  }

  let effectiveHost: AgentConnectorHost | null = selectedHost === "auto" ? null : selectedHost;
  if (!effectiveHost) {
    const codexApps = appForHost("codex", codex, claude);
    const claudeApps = appForHost("claude", codex, claude);
    if (codexApps.drive.connected) effectiveHost = "codex";
    else if (claudeApps.drive.connected) effectiveHost = "claude";
    else if (codex.available) effectiveHost = "codex";
    else if (claude.available) effectiveHost = "claude";
  }
  if (!effectiveHost) {
    return {
      selectedHost,
      effectiveHost: null,
      status: "needs_host",
      hosts,
      apps: {
        drive: { available: false, connected: false },
        gmail: { available: false, connected: false },
      },
      message: "Install and sign in to Codex or Claude Code on this machine to reuse its Google connectors.",
    };
  }

  const apps = appForHost(effectiveHost, codex, claude);
  const available = hostAvailable(effectiveHost, codex, claude);
  const signedIn = hostSignedIn(effectiveHost, codex, claude);
  let status: GoogleConnectorStatus["status"] = "needs_connectors";
  if (!available) status = "unavailable";
  else if (!signedIn) status = "needs_sign_in";
  else if (apps.drive.connected) status = "ready";
  const providerError = effectiveHost === "codex" ? codex.error : claude.error?.message;
  return {
    selectedHost,
    effectiveHost,
    status,
    hosts,
    apps,
    message: status === "ready"
      ? `${effectiveHost === "codex" ? "Codex" : "Claude Code"} owns the Google authorization; Studio Assistant stores no Google connector token. ${apps.gmail.connected ? "Gmail drafts are available." : "Gmail is optional and not connected."}`
      : providerError || `Connect Google Drive in ${effectiveHost === "codex" ? "Codex" : "Claude.ai"}.`,
  };
}

export function usesAgentGoogleConnectors() {
  return readSettings().connectors.host !== "direct-google";
}

export async function getGoogleConnectorStatus(options: { forceRefresh?: boolean } = {}) {
  const now = Date.now();
  if (!options.forceRefresh && runtime.status && runtime.status.expiresAt > now) return runtime.status.value;
  const value = inspectStatusUncached();
  runtime.status = { expiresAt: now + STATUS_CACHE_MS, value };
  try {
    const resolved = await value;
    runtime.lastStatus = resolved;
    return resolved;
  } catch (error) {
    if (runtime.status?.value === value) runtime.status = null;
    throw error;
  }
}

export function clearGoogleConnectorStatusCache() {
  runtime.status = null;
  runtime.lastStatus = null;
}

export async function requireAgentConnectorHost(app: GoogleConnectorApp): Promise<AgentConnectorHost> {
  const selected = readSettings().connectors.host;
  const remembered = runtime.lastStatus;
  const status = remembered && remembered.selectedHost === selected
    ? remembered
    : await getGoogleConnectorStatus();
  if (status.effectiveHost !== "codex" && status.effectiveHost !== "claude") {
    throw new Error("Select Automatic, Codex, or Claude Code before using Google connectors.");
  }
  if (!status.apps.drive.connected) {
    throw new Error(`Connect Google Drive in ${status.effectiveHost === "codex" ? "Codex" : "Claude.ai"} first.`);
  }
  if (app === "gmail" && !status.apps.gmail.connected) {
    throw new Error(`Connect Gmail in ${status.effectiveHost === "codex" ? "Codex" : "Claude.ai"} before creating drafts.`);
  }
  return status.effectiveHost;
}

function jsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function claudeKind(app: GoogleConnectorApp): ClaudeConnectorKind {
  return app === "drive" ? "google-drive" : "gmail";
}

function claudeToolPrefix(app: GoogleConnectorApp) {
  return mcpServerToolPrefix(app === "drive" ? "claude.ai Google Drive" : "claude.ai Gmail");
}

export async function callGoogleConnectorTool(
  host: AgentConnectorHost,
  app: GoogleConnectorApp,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!(SAFE_TOOLS as readonly string[]).includes(toolName)) {
    throw new Error(`Google connector tool ${toolName} is not allowed by Studio Assistant.`);
  }
  if (host === "codex") {
    const operation = async () => {
      const client = await codexClient();
      let tools = runtime.codexTools?.expiresAt && runtime.codexTools.expiresAt > Date.now()
        ? runtime.codexTools.tools
        : null;
      if (!tools) {
        const inventory = await client.discoverTools();
        tools = inventory.tools;
        runtime.codexTools = { expiresAt: Date.now() + 5 * 60_000, tools };
      }
      const tool = tools.find((candidate) => toolMatches(candidate, toolName));
      if (!tool) throw new Error(`Codex does not currently expose the required ${toolName} connector action.`);
      const outcome = await client.callMcpTool({
        server: tool.server,
        tool: tool.name,
        arguments: jsonObject(args),
        timeoutMs: 120_000,
      });
      if (outcome.status === "approval-needed") {
        runtime.codexClient = null;
        runtime.codexTools = null;
        await client.close().catch(() => undefined);
        throw new Error(
          "Codex asked for an interactive connector approval. Studio Assistant never approves Google access on your behalf; manage the app in Codex, then retry.",
        );
      }
      if (outcome.value.isError) {
        throw new Error(`The ${toolName} Google connector action failed.`);
      }
      return outcome.value;
    };
    const pending = runtime.codexToolTail.then(operation, operation);
    runtime.codexToolTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  const operation = async () => {
    const connector = claudeKind(app);
    const exactTool = `${claudeToolPrefix(app)}__${toolName}`;
    const result = await invokeClaudeConnectorOperation<{ result: unknown }>({
      action: toolName,
      prompt: "Perform the single Google connector operation described by the supplied tool name and arguments. Use one matching connector tool, then return its confirmed result in the result field.",
      input: { toolName, arguments: args },
      connectors: [connector],
      allowedTools: [exactTool],
      jsonSchema: {
        type: "object",
        properties: { result: {} },
        required: ["result"],
        additionalProperties: false,
      },
      timeoutMs: 120_000,
      cwd: process.cwd(),
    });
    return result.data.result;
  };
  const pending = runtime.claudeToolTail.then(operation, operation);
  runtime.claudeToolTail = pending.then(() => undefined, () => undefined);
  return pending;
}

export function connectorInstallUrl(status: GoogleConnectorStatus, app: GoogleConnectorApp) {
  return status.apps[app].installUrl ?? null;
}
