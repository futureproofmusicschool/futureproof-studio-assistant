import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type CodexCapabilityState = "unknown" | "supported" | "unsupported";
export type CodexAppStatus =
  | "callable"
  | "disabled"
  | "not-installed"
  | "unavailable"
  | "unknown";

export interface CodexMcpToolPermission {
  server: string;
  tool: string;
}

export interface CodexAppServerClientOptions {
  /** Executable to launch. Defaults to `codex`. No shell is involved. */
  command?: string;
  /** Defaults to `["app-server"]`, whose default transport is stdio JSONL. */
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  clientInfo?: {
    name: string;
    title?: string;
    version: string;
  };
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  turnTimeoutMs?: number;
  closeTimeoutMs?: number;
  maxJsonLineBytes?: number;
  maxStderrBytes?: number;
  /**
   * Exact allowlist for deterministic `mcpServer/tool/call` operations.
   * An empty or omitted list disables direct tool calls.
   */
  allowedMcpTools?: readonly CodexMcpToolPermission[];
}

export interface CodexConnectorCapabilities {
  transport: "stdio-jsonl";
  connectionState:
    | "starting"
    | "initializing"
    | "ready"
    | "closing"
    | "closed"
    | "failed";
  server: {
    userAgent: string | null;
    platformFamily: string | null;
    platformOs: string | null;
  } | null;
  client: {
    experimentalApi: true;
    appMentions: true;
    structuredOutput: true;
    userInputApprovals: true;
    automaticApproval: false;
    exactMcpToolAllowlist: true;
  };
  serverMethods: Readonly<Record<string, CodexCapabilityState>>;
  compatibilityWarnings: readonly string[];
  dedicatedThreadId: string | null;
}

export interface CodexAppDescriptor {
  id: string;
  name: string;
  description: string | null;
  installUrl: string | null;
  accessible: boolean | null;
  enabled: boolean | null;
  installed: boolean | null;
  callable: boolean | null;
  runtimeName: string | null;
  status: CodexAppStatus;
}

export type CodexMcpAuthStatus =
  | "unsupported"
  | "notLoggedIn"
  | "bearerToken"
  | "oAuth"
  | "unknown";

export interface CodexMcpServerDescriptor {
  name: string;
  authStatus: CodexMcpAuthStatus;
  displayName: string | null;
  version: string | null;
  description: string | null;
}

export interface CodexMcpToolDescriptor {
  server: string;
  serverAuthStatus: CodexMcpAuthStatus;
  name: string;
  title: string | null;
  description: string | null;
  inputSchema: JsonValue;
  outputSchema: JsonValue | null;
  annotations: JsonValue | null;
  meta: JsonValue | null;
}

export interface CodexMcpToolInventory {
  servers: CodexMcpServerDescriptor[];
  tools: CodexMcpToolDescriptor[];
}

export interface CodexUserInputApprovalOption {
  label: string;
  description: string;
}

export interface CodexUserInputApprovalQuestion {
  id: string;
  header: string;
  question: string;
  options: CodexUserInputApprovalOption[];
  isOther: boolean;
  isSecret: boolean;
}

export type CodexJsonRpcId = string | number;

export interface CodexUserInputApproval {
  requestId: CodexJsonRpcId;
  method: "item/tool/requestUserInput" | "tool/requestUserInput";
  threadId: string;
  turnId: string | null;
  itemId: string;
  questions: CodexUserInputApprovalQuestion[];
  autoResolutionMs: number | null;
}

export type CodexApprovalAnswers = Record<string, readonly string[]>;

export interface CodexCompletedMcpToolCall {
  id: string;
  server: string;
  tool: string;
  status: string;
  result: JsonValue | null;
  error: JsonValue | null;
}

export interface CodexStructuredAppResult<T = JsonValue> {
  data: T;
  rawText: string;
  toolCalls: CodexCompletedMcpToolCall[];
}

export interface CodexMcpToolResult<T = JsonValue> {
  content: JsonValue[];
  structuredContent: T | null;
  isError: boolean;
  meta: JsonValue | null;
}

export type CodexConnectorOutcome<T> =
  | {
      status: "completed";
      transport: "app-mention" | "mcp-tool";
      threadId: string;
      turnId: string | null;
      value: T;
    }
  | {
      status: "approval-needed";
      transport: "app-mention" | "mcp-tool";
      threadId: string;
      turnId: string | null;
      approval: CodexUserInputApproval;
    };

export interface CodexDedicatedThreadOptions {
  model?: string;
  cwd?: string;
  serviceName?: string;
  ephemeral?: boolean;
}

export interface CodexAppInvocationOptions {
  app: Pick<CodexAppDescriptor, "id" | "name">;
  prompt: string;
  outputSchema: JsonObject;
  timeoutMs?: number;
}

export interface CodexMcpToolCallOptions {
  server: string;
  tool: string;
  arguments?: JsonObject;
  meta?: JsonObject;
  timeoutMs?: number;
}

export class CodexAppServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class CodexAppServerRpcError extends CodexAppServerError {
  readonly method: string;
  readonly rpcCode: number;
  readonly rpcMessage: string;
  readonly rpcData: unknown;

  constructor(method: string, code: number, message: string, data?: unknown) {
    super(`Codex app-server ${method} failed (${code}): ${message}`);
    this.method = method;
    this.rpcCode = code;
    this.rpcMessage = message;
    this.rpcData = data;
  }
}

export class CodexAppServerTimeoutError extends CodexAppServerError {
  readonly operation: string;
  readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`Codex app-server ${operation} timed out after ${timeoutMs}ms.`);
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

export class CodexAppServerProcessError extends CodexAppServerError {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;

  constructor(
    message: string,
    details: {
      exitCode?: number | null;
      signal?: NodeJS.Signals | null;
      stderr?: string;
    } = {},
  ) {
    const stderr = details.stderr?.trim() ?? "";
    super(stderr ? `${message}\n${stderr}` : message);
    this.exitCode = details.exitCode ?? null;
    this.signal = details.signal ?? null;
    this.stderr = stderr;
  }
}

export class CodexAppServerProtocolError extends CodexAppServerError {}
export class CodexAppServerStateError extends CodexAppServerError {}

export class CodexAppServerVersionError extends CodexAppServerError {
  readonly method: string;
  readonly serverUserAgent: string | null;

  constructor(method: string, feature: string, serverUserAgent: string | null) {
    super(
      `This Codex app-server does not support ${feature} (${method}).` +
        (serverUserAgent ? ` Server: ${serverUserAgent}.` : " Update Codex and try again."),
    );
    this.method = method;
    this.serverUserAgent = serverUserAgent;
  }
}

export class CodexAppServerTurnError extends CodexAppServerError {
  readonly threadId: string;
  readonly turnId: string;
  readonly status: string;
  readonly turnError: JsonValue | null;

  constructor(
    threadId: string,
    turnId: string,
    status: string,
    turnError: JsonValue | null,
  ) {
    const detail = extractErrorMessage(turnError);
    super(
      `Codex connector turn ${turnId} ${status}.` + (detail ? ` ${detail}` : ""),
    );
    this.threadId = threadId;
    this.turnId = turnId;
    this.status = status;
    this.turnError = turnError;
  }
}

type ConnectionState = CodexConnectorCapabilities["connectionState"];

interface JsonRpcResponseError {
  code: number;
  message: string;
  data?: unknown;
}

interface PendingRpc {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface QueuedResult {
  value?: CodexConnectorOutcome<unknown>;
  error?: Error;
}

interface OperationWaiter {
  resolve: (value: CodexConnectorOutcome<unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ActiveOperation {
  token: number;
  kind: "app-mention" | "mcp-tool";
  threadId: string;
  turnId: string | null;
  rpcId: number | null;
  items: Map<string, JsonObject>;
  queue: QueuedResult[];
  waiter: OperationWaiter | null;
  finished: boolean;
}

interface PendingApproval {
  request: CodexUserInputApproval;
  operationToken: number | null;
  reported: boolean;
  answered: boolean;
}

interface InitializeResult {
  userAgent: string | null;
  platformFamily: string | null;
  platformOs: string | null;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TURN_TIMEOUT_MS = 120_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 1_500;
const DEFAULT_MAX_LINE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
const MAX_PAGES = 100;
const MAX_EARLY_EVENTS = 250;
const MAX_PENDING_APPROVALS = 50;

const CONNECTOR_THREAD_INSTRUCTIONS = [
  "Act only as a connector execution bridge for the explicitly mentioned app.",
  "Allowed actions are read/search, creating or updating Google Drive documents, sheets, files, and folders, and creating unsent Gmail drafts.",
  "Never send email or messages. Never delete or trash data, alter sharing or permissions, use shell commands, edit local files, browse the web, or use an unmentioned service.",
  "Use the minimum connector action needed. If the action needs user approval, request it and wait.",
  "Return only the JSON value required by the supplied output schema.",
].join(" ");

const TRACKED_METHODS = [
  "initialize",
  "app/list",
  "app/installed",
  "mcpServerStatus/list",
  "mcpServer/tool/call",
  "thread/start",
  "thread/resume",
  "turn/start",
  "turn/interrupt",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asJsonValue(value: unknown): JsonValue | null {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return null;
  }
}

function requiredPositiveInteger(value: number | undefined, fallback: number, name: string) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new CodexAppServerStateError(`${name} must be a positive integer.`);
  }
  return resolved;
}

function validateIdentifier(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new CodexAppServerStateError(`${label} is required.`);
  if (/\r|\n|\0/.test(trimmed)) {
    throw new CodexAppServerStateError(`${label} contains invalid control characters.`);
  }
  return trimmed;
}

function validateAppId(value: string) {
  const id = validateIdentifier(value, "App id");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new CodexAppServerStateError(
      "App id may contain only letters, numbers, dots, underscores, and hyphens.",
    );
  }
  return id;
}

function assertJsonObject(value: JsonObject, label: string) {
  if (!isRecord(value)) {
    throw new CodexAppServerStateError(`${label} must be a JSON object.`);
  }
  try {
    JSON.stringify(value);
  } catch {
    throw new CodexAppServerStateError(`${label} must be JSON-serializable.`);
  }
}

function rpcIdKey(id: CodexJsonRpcId) {
  return `${typeof id}:${String(id)}`;
}

function isMethodNotFound(error: unknown): error is CodexAppServerRpcError {
  return (
    error instanceof CodexAppServerRpcError &&
    isUnsupportedRpcResponse(error.rpcCode, error.rpcMessage)
  );
}

function isUnsupportedRpcResponse(code: number, message: string) {
  return (
    code === -32601 ||
    (code === -32600 && /invalid request:\s*unknown variant\b/i.test(message))
  );
}

function extractErrorMessage(value: JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return typeof value.message === "string" ? value.message : "";
}

function normalizeAppStatus(input: {
  accessible: boolean | null;
  enabled: boolean | null;
  installed: boolean | null;
  callable: boolean | null;
}): CodexAppStatus {
  if (input.callable === true) return "callable";
  if (input.enabled === false) return "disabled";
  if (input.installed === false || input.accessible === false) return "not-installed";
  if (input.callable === false) return "unavailable";
  return "unknown";
}

function parseStructuredText(text: string): JsonValue {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new CodexAppServerProtocolError(
      "Codex connector turn completed without a structured agent response.",
    );
  }
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate) as JsonValue;
  } catch (error) {
    throw new CodexAppServerProtocolError(
      `Codex connector returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function mcpPermissionKey(server: string, tool: string) {
  return `${server}\0${tool}`;
}

/**
 * A local Codex app-server client. It deliberately never answers approval
 * requests on its own; the host must display and explicitly answer them.
 */
export class CodexAppServerClient {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly decoder = new StringDecoder("utf8");
  private readonly requestTimeoutMs: number;
  private readonly turnTimeoutMs: number;
  private readonly closeTimeoutMs: number;
  private readonly maxJsonLineBytes: number;
  private readonly maxStderrBytes: number;
  private readonly defaultThreadCwd: string;
  private readonly allowedMcpTools: Set<string>;
  private readonly pendingRpc = new Map<number, PendingRpc>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly earlyTurnEvents = new Map<
    string,
    Array<{ method: string; params: Record<string, unknown> }>
  >();
  private readonly methodStates: Record<string, CodexCapabilityState>;
  private readonly compatibilityWarnings: string[] = [];
  private readonly exitWaiters: Array<() => void> = [];

  private connectionState: ConnectionState = "starting";
  private stdoutBuffer = "";
  private stderrTail = "";
  private nextRpcId = 1;
  private nextOperationToken = 1;
  private initializeResult: InitializeResult | null = null;
  private activeOperation: ActiveOperation | null = null;
  private fatalError: Error | null = null;
  private processExited = false;
  private _dedicatedThreadId: string | null = null;

  private constructor(options: CodexAppServerClientOptions) {
    this.requestTimeoutMs = requiredPositiveInteger(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      "requestTimeoutMs",
    );
    this.turnTimeoutMs = requiredPositiveInteger(
      options.turnTimeoutMs,
      DEFAULT_TURN_TIMEOUT_MS,
      "turnTimeoutMs",
    );
    this.closeTimeoutMs = requiredPositiveInteger(
      options.closeTimeoutMs,
      DEFAULT_CLOSE_TIMEOUT_MS,
      "closeTimeoutMs",
    );
    this.maxJsonLineBytes = requiredPositiveInteger(
      options.maxJsonLineBytes,
      DEFAULT_MAX_LINE_BYTES,
      "maxJsonLineBytes",
    );
    this.maxStderrBytes = requiredPositiveInteger(
      options.maxStderrBytes,
      DEFAULT_MAX_STDERR_BYTES,
      "maxStderrBytes",
    );
    this.defaultThreadCwd = path.resolve(options.cwd ?? process.cwd());
    this.allowedMcpTools = new Set(
      (options.allowedMcpTools ?? []).map(({ server, tool }) =>
        mcpPermissionKey(
          validateIdentifier(server, "Allowed MCP server"),
          validateIdentifier(tool, "Allowed MCP tool"),
        ),
      ),
    );
    this.methodStates = Object.fromEntries(
      TRACKED_METHODS.map((method) => [method, "unknown" as CodexCapabilityState]),
    );

    const command = validateIdentifier(options.command ?? "codex", "Codex command");
    const args = options.args ? [...options.args] : ["app-server"];
    const spawnOptions: SpawnOptionsWithoutStdio = {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
    };
    this.process = spawn(command, args, {
      ...spawnOptions,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.bindProcess();
  }

  static async connect(
    options: CodexAppServerClientOptions = {},
  ): Promise<CodexAppServerClient> {
    const client = new CodexAppServerClient(options);
    const startupTimeoutMs = requiredPositiveInteger(
      options.startupTimeoutMs,
      DEFAULT_STARTUP_TIMEOUT_MS,
      "startupTimeoutMs",
    );
    try {
      await client.initialize(options.clientInfo, startupTimeoutMs);
      return client;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  get dedicatedThreadId() {
    return this._dedicatedThreadId;
  }

  getCapabilities(): CodexConnectorCapabilities {
    return {
      transport: "stdio-jsonl",
      connectionState: this.connectionState,
      server: this.initializeResult ? { ...this.initializeResult } : null,
      client: {
        experimentalApi: true,
        appMentions: true,
        structuredOutput: true,
        userInputApprovals: true,
        automaticApproval: false,
        exactMcpToolAllowlist: true,
      },
      serverMethods: { ...this.methodStates },
      compatibilityWarnings: [...this.compatibilityWarnings],
      dedicatedThreadId: this._dedicatedThreadId,
    };
  }

  async discoverApps(options: {
    threadId?: string;
    forceRefresh?: boolean;
  } = {}): Promise<CodexAppDescriptor[]> {
    this.assertReady();
    const threadId = options.threadId ?? this._dedicatedThreadId ?? undefined;
    const catalog = new Map<string, Record<string, unknown>>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      let raw: unknown;
      try {
        raw = await this.request("app/list", {
          cursor,
          limit: 100,
          ...(threadId ? { threadId } : {}),
          forceRefetch: options.forceRefresh === true,
        });
      } catch (error) {
        if (isMethodNotFound(error)) {
          throw this.versionError("app/list", "app discovery");
        }
        throw error;
      }
      if (!isRecord(raw) || !Array.isArray(raw.data)) {
        throw new CodexAppServerProtocolError("app/list returned an invalid response.");
      }
      for (const item of raw.data) {
        if (!isRecord(item) || typeof item.id !== "string") continue;
        catalog.set(item.id, item);
      }
      const nextCursor = asString(raw.nextCursor);
      if (!nextCursor) break;
      if (seenCursors.has(nextCursor)) {
        throw new CodexAppServerProtocolError("app/list repeated a pagination cursor.");
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
      if (page === MAX_PAGES - 1) {
        throw new CodexAppServerProtocolError("app/list exceeded the pagination limit.");
      }
    }

    let installedSupported = true;
    const installed = new Map<string, Record<string, unknown>>();
    try {
      const raw = await this.request("app/installed", {
        ...(threadId ? { threadId } : {}),
        forceRefresh: options.forceRefresh === true,
      });
      if (!isRecord(raw) || !Array.isArray(raw.apps)) {
        throw new CodexAppServerProtocolError(
          "app/installed returned an invalid response.",
        );
      }
      for (const item of raw.apps) {
        if (!isRecord(item) || typeof item.id !== "string") continue;
        installed.set(item.id, item);
      }
    } catch (error) {
      if (!isMethodNotFound(error)) throw error;
      installedSupported = false;
      this.addCompatibilityWarning(
        "app/installed is unavailable; installed and callable status are unknown.",
      );
    }

    return Array.from(catalog.values()).map((item) => {
      const id = item.id as string;
      const runtime = installed.get(id);
      const accessible = asBoolean(item.isAccessible);
      const enabled = asBoolean(item.isEnabled);
      const installedValue = installedSupported ? installed.has(id) : null;
      const callable = runtime ? asBoolean(runtime.callable) : installedSupported ? false : null;
      const descriptor: CodexAppDescriptor = {
        id,
        name: asString(item.name) ?? asString(runtime?.runtimeName) ?? id,
        description: asString(item.description),
        installUrl: asString(item.installUrl),
        accessible,
        enabled,
        installed: installedValue,
        callable,
        runtimeName: asString(runtime?.runtimeName),
        status: "unknown",
      };
      descriptor.status = normalizeAppStatus(descriptor);
      return descriptor;
    });
  }

  async discoverTools(options: {
    threadId?: string;
  } = {}): Promise<CodexMcpToolInventory> {
    this.assertReady();
    const threadId = options.threadId ?? this.requireThreadId();
    const servers: CodexMcpServerDescriptor[] = [];
    const tools: CodexMcpToolDescriptor[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      let raw: unknown;
      try {
        raw = await this.request("mcpServerStatus/list", {
          threadId,
          cursor,
          limit: 100,
          detail: "toolsAndAuthOnly",
        });
      } catch (error) {
        if (isMethodNotFound(error)) {
          throw this.versionError("mcpServerStatus/list", "MCP tool discovery");
        }
        throw error;
      }
      if (!isRecord(raw) || !Array.isArray(raw.data)) {
        throw new CodexAppServerProtocolError(
          "mcpServerStatus/list returned an invalid response.",
        );
      }
      for (const item of raw.data) {
        if (!isRecord(item) || typeof item.name !== "string") continue;
        const serverName = item.name;
        const authStatus = normalizeAuthStatus(item.authStatus);
        const info = isRecord(item.serverInfo) ? item.serverInfo : null;
        servers.push({
          name: serverName,
          authStatus,
          displayName: asString(info?.title) ?? asString(info?.name),
          version: asString(info?.version),
          description: asString(info?.description),
        });
        if (!isRecord(item.tools)) continue;
        for (const [mapName, rawTool] of Object.entries(item.tools)) {
          if (!isRecord(rawTool)) continue;
          const name = asString(rawTool.name) ?? mapName;
          tools.push({
            server: serverName,
            serverAuthStatus: authStatus,
            name,
            title: asString(rawTool.title),
            description: asString(rawTool.description),
            inputSchema: asJsonValue(rawTool.inputSchema) ?? {},
            outputSchema:
              rawTool.outputSchema === undefined
                ? null
                : asJsonValue(rawTool.outputSchema),
            annotations:
              rawTool.annotations === undefined ? null : asJsonValue(rawTool.annotations),
            meta: rawTool._meta === undefined ? null : asJsonValue(rawTool._meta),
          });
        }
      }
      const nextCursor = asString(raw.nextCursor);
      if (!nextCursor) break;
      if (seenCursors.has(nextCursor)) {
        throw new CodexAppServerProtocolError(
          "mcpServerStatus/list repeated a pagination cursor.",
        );
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
      if (page === MAX_PAGES - 1) {
        throw new CodexAppServerProtocolError(
          "mcpServerStatus/list exceeded the pagination limit.",
        );
      }
    }

    return { servers, tools };
  }

  async startDedicatedThread(
    options: CodexDedicatedThreadOptions = {},
  ): Promise<string> {
    this.assertReady();
    this.assertNoActiveOperation();
    let raw: unknown;
    try {
      raw = await this.request("thread/start", this.threadParams(options));
    } catch (error) {
      if (isMethodNotFound(error)) {
        throw this.versionError("thread/start", "connector threads");
      }
      throw error;
    }
    const threadId = parseThreadId(raw, "thread/start");
    this._dedicatedThreadId = threadId;
    return threadId;
  }

  async resumeDedicatedThread(
    threadId: string,
    options: CodexDedicatedThreadOptions = {},
  ): Promise<string> {
    this.assertReady();
    this.assertNoActiveOperation();
    const requestedId = validateIdentifier(threadId, "Thread id");
    let raw: unknown;
    try {
      raw = await this.request("thread/resume", {
        threadId: requestedId,
        ...this.threadParams(options, true),
      });
    } catch (error) {
      if (isMethodNotFound(error)) {
        throw this.versionError("thread/resume", "resumable connector threads");
      }
      throw error;
    }
    const resumedId = parseThreadId(raw, "thread/resume");
    if (resumedId !== requestedId) {
      throw new CodexAppServerProtocolError(
        `thread/resume returned ${resumedId} instead of ${requestedId}.`,
      );
    }
    this._dedicatedThreadId = resumedId;
    return resumedId;
  }

  async invokeApp<T = JsonValue>(
    options: CodexAppInvocationOptions,
  ): Promise<CodexConnectorOutcome<CodexStructuredAppResult<T>>> {
    this.assertReady();
    this.assertNoActiveOperation();
    const threadId = this.requireThreadId();
    const appId = validateAppId(options.app.id);
    const appName = validateIdentifier(options.app.name, "App name");
    const prompt = validateIdentifier(options.prompt, "App prompt");
    assertJsonObject(options.outputSchema, "outputSchema");
    const timeoutMs = requiredPositiveInteger(
      options.timeoutMs,
      this.turnTimeoutMs,
      "timeoutMs",
    );
    const operation = this.createOperation("app-mention", threadId);

    let raw: unknown;
    try {
      raw = await this.request("turn/start", {
        threadId,
        input: [
          {
            type: "text",
            text: `$${appId} ${prompt}\n\nReturn only the JSON value required by the response schema.`,
          },
          { type: "mention", name: appName, path: `app://${appId}` },
        ],
        outputSchema: options.outputSchema,
      });
    } catch (error) {
      this.discardOperation(operation);
      if (isMethodNotFound(error)) {
        throw this.versionError("turn/start", "app invocation");
      }
      if (
        error instanceof CodexAppServerRpcError &&
        /outputSchema|output schema/i.test(error.message)
      ) {
        this.methodStates["turn/start"] = "supported";
        throw this.versionError("turn/start.outputSchema", "structured app results");
      }
      throw error;
    }
    if (!isRecord(raw) || !isRecord(raw.turn) || typeof raw.turn.id !== "string") {
      this.discardOperation(operation);
      throw new CodexAppServerProtocolError("turn/start returned an invalid response.");
    }
    operation.turnId = raw.turn.id;
    this.replayEarlyTurnEvents(operation);
    this.surfacePendingApprovals(operation);
    return (await this.waitForOperation(operation, timeoutMs)) as CodexConnectorOutcome<
      CodexStructuredAppResult<T>
    >;
  }

  async callMcpTool<T = JsonValue>(
    options: CodexMcpToolCallOptions,
  ): Promise<CodexConnectorOutcome<CodexMcpToolResult<T>>> {
    this.assertReady();
    this.assertNoActiveOperation();
    const threadId = this.requireThreadId();
    const server = validateIdentifier(options.server, "MCP server");
    const tool = validateIdentifier(options.tool, "MCP tool");
    if (!this.allowedMcpTools.has(mcpPermissionKey(server, tool))) {
      throw new CodexAppServerStateError(
        `Direct MCP tool call ${server}/${tool} is not in this client's exact allowlist.`,
      );
    }
    const args = options.arguments ?? {};
    assertJsonObject(args, "MCP tool arguments");
    if (options.meta) assertJsonObject(options.meta, "MCP tool metadata");
    const timeoutMs = requiredPositiveInteger(
      options.timeoutMs,
      this.turnTimeoutMs,
      "timeoutMs",
    );
    const operation = this.createOperation("mcp-tool", threadId);
    const request = this.beginRequest(
      "mcpServer/tool/call",
      {
        threadId,
        server,
        tool,
        arguments: args,
        ...(options.meta ? { _meta: options.meta } : {}),
      },
      null,
    );
    operation.rpcId = request.id;
    void request.promise.then(
      (raw) => {
        try {
          const value = parseMcpToolResult<T>(raw);
          this.completeOperation(operation, {
            status: "completed",
            transport: "mcp-tool",
            threadId,
            turnId: operation.turnId,
            value,
          });
        } catch (error) {
          this.failOperation(
            operation,
            error instanceof Error ? error : new CodexAppServerProtocolError(String(error)),
          );
        }
      },
      (error: unknown) => {
        const normalized =
          error instanceof Error ? error : new CodexAppServerError(String(error));
        if (isMethodNotFound(normalized)) {
          this.failOperation(
            operation,
            this.versionError("mcpServer/tool/call", "direct MCP tool calls"),
          );
          return;
        }
        this.failOperation(operation, normalized);
      },
    );
    this.surfacePendingApprovals(operation);
    return (await this.waitForOperation(operation, timeoutMs)) as CodexConnectorOutcome<
      CodexMcpToolResult<T>
    >;
  }

  listPendingApprovals(): CodexUserInputApproval[] {
    return Array.from(this.pendingApprovals.values()).map(({ request }) => ({
      ...request,
      questions: request.questions.map((question) => ({
        ...question,
        options: question.options.map((option) => ({ ...option })),
      })),
    }));
  }

  async respondToApproval<T>(
    requestId: CodexJsonRpcId,
    answers: CodexApprovalAnswers,
    options: { timeoutMs?: number } = {},
  ): Promise<CodexConnectorOutcome<T>> {
    this.assertReady();
    const key = rpcIdKey(requestId);
    const pending = this.pendingApprovals.get(key);
    if (!pending || pending.answered) {
      throw new CodexAppServerStateError(
        `Approval request ${String(requestId)} is no longer pending.`,
      );
    }
    const operation = this.activeOperation;
    if (!operation || pending.operationToken !== operation.token || operation.finished) {
      throw new CodexAppServerStateError(
        `Approval request ${String(requestId)} is not attached to an active operation.`,
      );
    }
    const responseAnswers = validateApprovalAnswers(pending.request, answers);
    pending.answered = true;
    this.removeQueuedApproval(operation, requestId);
    try {
      await this.writeMessage({ id: requestId, result: { answers: responseAnswers } });
    } catch (error) {
      pending.answered = false;
      throw error;
    }
    this.pendingApprovals.delete(key);
    const timeoutMs = requiredPositiveInteger(
      options.timeoutMs,
      this.turnTimeoutMs,
      "timeoutMs",
    );
    this.surfacePendingApprovals(operation);
    return (await this.waitForOperation(operation, timeoutMs)) as CodexConnectorOutcome<T>;
  }

  async interruptActiveInvocation(): Promise<void> {
    this.assertReady();
    const operation = this.activeOperation;
    if (!operation || operation.finished) return;
    if (operation.kind !== "app-mention" || !operation.turnId) {
      throw new CodexAppServerStateError(
        "A direct MCP call cannot be interrupted safely. Answer its pending prompt (for example, Cancel) or close the client.",
      );
    }
    try {
      await this.request("turn/interrupt", {
        threadId: operation.threadId,
        turnId: operation.turnId,
      });
    } catch (error) {
      if (isMethodNotFound(error)) {
        throw this.versionError("turn/interrupt", "turn interruption");
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.connectionState === "closed") return;
    if (this.connectionState !== "closing") {
      this.connectionState = "closing";
      this.failOutstanding(
        new CodexAppServerProcessError("Codex app-server client was closed.", {
          stderr: this.stderrTail,
        }),
      );
      if (!this.process.stdin.destroyed) this.process.stdin.end();
    }
    if (this.processExited) {
      this.connectionState = "closed";
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        if (!this.processExited) this.process.kill("SIGTERM");
        finish();
      }, this.closeTimeoutMs);
      timer.unref?.();
      this.exitWaiters.push(finish);
    });
    this.connectionState = "closed";
  }

  private bindProcess() {
    this.process.stdout.on("data", (chunk: Buffer | string) => {
      if (this.fatalError) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      this.stdoutBuffer += this.decoder.write(buffer);
      this.consumeStdoutLines();
    });
    this.process.stdout.on("end", () => {
      if (this.fatalError) return;
      this.stdoutBuffer += this.decoder.end();
      if (this.stdoutBuffer.trim()) this.consumeProtocolLine(this.stdoutBuffer);
      this.stdoutBuffer = "";
    });
    this.process.stderr.on("data", (chunk: Buffer | string) => {
      this.stderrTail += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      if (Buffer.byteLength(this.stderrTail, "utf8") > this.maxStderrBytes) {
        const tail = Buffer.from(this.stderrTail, "utf8").subarray(-this.maxStderrBytes);
        this.stderrTail = tail.toString("utf8");
      }
    });
    this.process.on("error", (error) => {
      this.failConnection(
        new CodexAppServerProcessError(`Failed to launch Codex app-server: ${error.message}`, {
          stderr: this.stderrTail,
        }),
        false,
      );
    });
    this.process.on("exit", (code, signal) => {
      this.processExited = true;
      for (const resolve of this.exitWaiters.splice(0)) resolve();
      if (this.connectionState === "closing" || this.connectionState === "closed") return;
      this.failConnection(
        new CodexAppServerProcessError(
          `Codex app-server exited unexpectedly` +
            (code !== null ? ` with code ${code}` : signal ? ` from ${signal}` : "") +
            ".",
          { exitCode: code, signal, stderr: this.stderrTail },
        ),
        false,
      );
    });
  }

  private async initialize(
    clientInfo: CodexAppServerClientOptions["clientInfo"],
    startupTimeoutMs: number,
  ) {
    this.connectionState = "initializing";
    const raw = await this.request(
      "initialize",
      {
        clientInfo: clientInfo ?? {
          name: "futureproof_studio_assistant",
          title: "Futureproof Studio Assistant",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
          mcpServerOpenaiFormElicitation: false,
          optOutNotificationMethods: [
            "item/agentMessage/delta",
            "item/reasoning/summaryTextDelta",
            "item/reasoning/summaryPartAdded",
            "item/reasoning/textDelta",
          ],
        },
      },
      startupTimeoutMs,
      true,
    );
    if (!isRecord(raw)) {
      throw new CodexAppServerProtocolError("initialize returned an invalid response.");
    }
    this.initializeResult = {
      userAgent: asString(raw.userAgent),
      platformFamily: asString(raw.platformFamily),
      platformOs: asString(raw.platformOs),
    };
    // Wait for the initialize response before acknowledging. Sending normal
    // requests before this notification is a protocol error on the server.
    await this.writeMessage({ method: "initialized", params: {} });
    this.connectionState = "ready";
  }

  private consumeStdoutLines() {
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      let line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (Buffer.byteLength(line, "utf8") > this.maxJsonLineBytes) {
        this.failConnection(
          new CodexAppServerProtocolError(
            `Codex app-server emitted a JSONL record larger than ${this.maxJsonLineBytes} bytes.`,
          ),
          true,
        );
        return;
      }
      if (line.trim()) this.consumeProtocolLine(line);
      if (this.fatalError) return;
      newline = this.stdoutBuffer.indexOf("\n");
    }
    if (Buffer.byteLength(this.stdoutBuffer, "utf8") > this.maxJsonLineBytes) {
      this.failConnection(
        new CodexAppServerProtocolError(
          `Codex app-server exceeded the ${this.maxJsonLineBytes}-byte JSONL buffer limit.`,
        ),
        true,
      );
    }
  }

  private consumeProtocolLine(line: string) {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.failConnection(
        new CodexAppServerProtocolError(
          `Codex app-server emitted invalid JSONL: ${error instanceof Error ? error.message : String(error)}`,
        ),
        true,
      );
      return;
    }
    if (!isRecord(message)) {
      this.failConnection(
        new CodexAppServerProtocolError("Codex app-server emitted a non-object message."),
        true,
      );
      return;
    }
    const method = asString(message.method);
    const hasId = Object.prototype.hasOwnProperty.call(message, "id");
    if (method && hasId) {
      this.handleServerRequest(message as Record<string, unknown> & { method: string });
      return;
    }
    if (method) {
      this.handleNotification(method, isRecord(message.params) ? message.params : {});
      return;
    }
    if (hasId) {
      this.handleResponse(message);
      return;
    }
    this.failConnection(
      new CodexAppServerProtocolError("Codex app-server emitted an unrecognized message."),
      true,
    );
  }

  private handleResponse(message: Record<string, unknown>) {
    if (typeof message.id !== "number") return;
    const pending = this.pendingRpc.get(message.id);
    if (!pending) return;
    this.pendingRpc.delete(message.id);
    if (pending.timer) clearTimeout(pending.timer);
    if (isRecord(message.error)) {
      const error = parseRpcError(message.error);
      this.methodStates[pending.method] = isUnsupportedRpcResponse(
        error.code,
        error.message,
      )
        ? "unsupported"
        : "supported";
      pending.reject(
        new CodexAppServerRpcError(
          pending.method,
          error.code,
          error.message,
          error.data,
        ),
      );
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(message, "result")) {
      pending.reject(
        new CodexAppServerProtocolError(
          `Codex app-server response to ${pending.method} had neither result nor error.`,
        ),
      );
      return;
    }
    this.methodStates[pending.method] = "supported";
    pending.resolve(message.result);
  }

  private handleServerRequest(
    message: Record<string, unknown> & { method: string },
  ) {
    const id = message.id;
    if (typeof id !== "string" && typeof id !== "number") {
      this.failConnection(
        new CodexAppServerProtocolError(
          `Server request ${message.method} has an invalid id.`,
        ),
        true,
      );
      return;
    }
    if (
      message.method === "item/tool/requestUserInput" ||
      message.method === "tool/requestUserInput"
    ) {
      try {
        const request = parseApprovalRequest(
          id,
          message.method,
          isRecord(message.params) ? message.params : {},
        );
        if (this.pendingApprovals.size >= MAX_PENDING_APPROVALS) {
          throw new CodexAppServerProtocolError(
            "Codex app-server exceeded the pending approval limit.",
          );
        }
        const pending: PendingApproval = {
          request,
          operationToken: null,
          reported: false,
          answered: false,
        };
        this.pendingApprovals.set(rpcIdKey(id), pending);
        this.attachApproval(pending);
      } catch (error) {
        void this.writeMessage({
          id,
          error: {
            code: -32602,
            message: error instanceof Error ? error.message : String(error),
          },
        }).catch(() => undefined);
      }
      return;
    }

    // Unknown server-initiated methods must never be approved implicitly.
    void this.writeMessage({
      id,
      error: {
        code: -32601,
        message: `Client does not support server request ${message.method}.`,
      },
    }).catch(() => undefined);
  }

  private handleNotification(method: string, params: Record<string, unknown>) {
    if (method === "serverRequest/resolved") {
      const id = params.requestId;
      if (typeof id === "string" || typeof id === "number") {
        const pending = this.pendingApprovals.get(rpcIdKey(id));
        this.pendingApprovals.delete(rpcIdKey(id));
        if (pending && this.activeOperation?.token === pending.operationToken) {
          this.removeQueuedApproval(this.activeOperation, id);
        }
      }
      return;
    }
    if (method !== "item/completed" && method !== "turn/completed") return;
    const turnId =
      asString(params.turnId) ??
      (isRecord(params.turn) ? asString(params.turn.id) : null);
    if (!turnId) return;
    const operation = this.activeOperation;
    if (
      operation?.kind === "app-mention" &&
      operation.turnId === turnId &&
      operation.threadId === asString(params.threadId)
    ) {
      this.processTurnEvent(operation, method, params);
      return;
    }
    const existing = this.earlyTurnEvents.get(turnId) ?? [];
    const eventCount = Array.from(this.earlyTurnEvents.values()).reduce(
      (total, events) => total + events.length,
      0,
    );
    if (eventCount >= MAX_EARLY_EVENTS) {
      this.failConnection(
        new CodexAppServerProtocolError(
          "Codex app-server exceeded the early event buffer limit.",
        ),
        true,
      );
      return;
    }
    existing.push({ method, params });
    this.earlyTurnEvents.set(turnId, existing);
  }

  private processTurnEvent(
    operation: ActiveOperation,
    method: string,
    params: Record<string, unknown>,
  ) {
    if (operation.finished) return;
    if (method === "item/completed") {
      const item = isRecord(params.item) ? params.item : null;
      if (item && typeof item.id === "string") {
        operation.items.set(item.id, item as JsonObject);
      }
      return;
    }
    const turn = isRecord(params.turn) ? params.turn : null;
    if (!turn || typeof turn.id !== "string") {
      this.failOperation(
        operation,
        new CodexAppServerProtocolError("turn/completed returned an invalid turn."),
      );
      return;
    }
    if (Array.isArray(turn.items)) {
      for (const rawItem of turn.items) {
        if (isRecord(rawItem) && typeof rawItem.id === "string") {
          operation.items.set(rawItem.id, rawItem as JsonObject);
        }
      }
    }
    const status = asString(turn.status) ?? "unknown";
    if (status !== "completed") {
      this.failOperation(
        operation,
        new CodexAppServerTurnError(
          operation.threadId,
          turn.id,
          status,
          asJsonValue(turn.error),
        ),
      );
      return;
    }
    try {
      const items = Array.from(operation.items.values());
      const messages = items.filter(
        (item) => item.type === "agentMessage" && typeof item.text === "string",
      );
      const finalMessage =
        [...messages].reverse().find((item) => item.phase === "final_answer") ??
        messages.at(-1);
      if (!finalMessage || typeof finalMessage.text !== "string") {
        throw new CodexAppServerProtocolError(
          "Connector turn completed without a final agent message.",
        );
      }
      const toolCalls: CodexCompletedMcpToolCall[] = items
        .filter((item) => item.type === "mcpToolCall")
        .map((item) => ({
          id: asString(item.id) ?? "",
          server: asString(item.server) ?? "",
          tool: asString(item.tool) ?? "",
          status: asString(item.status) ?? "unknown",
          result: asJsonValue(item.result),
          error: asJsonValue(item.error),
        }));
      const value: CodexStructuredAppResult = {
        data: parseStructuredText(finalMessage.text),
        rawText: finalMessage.text,
        toolCalls,
      };
      this.completeOperation(operation, {
        status: "completed",
        transport: "app-mention",
        threadId: operation.threadId,
        turnId: operation.turnId,
        value,
      });
    } catch (error) {
      this.failOperation(
        operation,
        error instanceof Error ? error : new CodexAppServerProtocolError(String(error)),
      );
    }
  }

  private threadParams(options: CodexDedicatedThreadOptions, resume = false) {
    return {
      cwd: path.resolve(options.cwd ?? this.defaultThreadCwd),
      sandbox: "read-only",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      developerInstructions: CONNECTOR_THREAD_INSTRUCTIONS,
      ...(!resume
        ? {
            serviceName:
              options.serviceName ?? "futureproof_studio_assistant_connectors",
            ephemeral: options.ephemeral ?? false,
          }
        : {}),
      ...(options.model ? { model: options.model } : {}),
    };
  }

  private createOperation(kind: ActiveOperation["kind"], threadId: string) {
    const operation: ActiveOperation = {
      token: this.nextOperationToken++,
      kind,
      threadId,
      turnId: null,
      rpcId: null,
      items: new Map(),
      queue: [],
      waiter: null,
      finished: false,
    };
    this.activeOperation = operation;
    return operation;
  }

  private discardOperation(operation: ActiveOperation) {
    operation.finished = true;
    if (operation.waiter) {
      clearTimeout(operation.waiter.timer);
      operation.waiter = null;
    }
    if (this.activeOperation?.token === operation.token) this.activeOperation = null;
    this.clearApprovalsForOperation(operation);
  }

  private completeOperation(
    operation: ActiveOperation,
    outcome: CodexConnectorOutcome<unknown>,
  ) {
    if (operation.finished) return;
    operation.finished = true;
    this.clearApprovalsForOperation(operation);
    this.enqueueOperationResult(operation, { value: outcome });
    if (this.activeOperation?.token === operation.token) this.activeOperation = null;
  }

  private failOperation(operation: ActiveOperation, error: Error) {
    if (operation.finished) return;
    operation.finished = true;
    this.clearApprovalsForOperation(operation);
    this.enqueueOperationResult(operation, { error });
    if (this.activeOperation?.token === operation.token) this.activeOperation = null;
  }

  private enqueueOperationResult(operation: ActiveOperation, result: QueuedResult) {
    if (operation.waiter) {
      const waiter = operation.waiter;
      operation.waiter = null;
      clearTimeout(waiter.timer);
      if (result.error) waiter.reject(result.error);
      else if (result.value) waiter.resolve(result.value);
      return;
    }
    operation.queue.push(result);
  }

  private waitForOperation(
    operation: ActiveOperation,
    timeoutMs: number,
  ): Promise<CodexConnectorOutcome<unknown>> {
    const queued = operation.queue.shift();
    if (queued) {
      if (queued.error) return Promise.reject(queued.error);
      if (queued.value) return Promise.resolve(queued.value);
    }
    if (operation.waiter) {
      return Promise.reject(
        new CodexAppServerStateError("This connector operation already has a waiter."),
      );
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        operation.waiter = null;
        const error = new CodexAppServerTimeoutError(
          operation.kind === "mcp-tool" ? "MCP tool call" : "connector turn",
          timeoutMs,
        );
        reject(error);
        if (operation.kind === "app-mention" && operation.turnId) {
          void this.request("turn/interrupt", {
            threadId: operation.threadId,
            turnId: operation.turnId,
          }).catch((interruptError) => {
            this.failConnection(
              interruptError instanceof Error
                ? interruptError
                : new CodexAppServerError(String(interruptError)),
              true,
            );
          });
        } else {
          this.failConnection(error, true);
        }
      }, timeoutMs);
      timer.unref?.();
      operation.waiter = { resolve, reject, timer };
    });
  }

  private attachApproval(pending: PendingApproval) {
    const operation = this.activeOperation;
    if (!operation || operation.finished) return;
    const request = pending.request;
    const matches =
      request.threadId === operation.threadId &&
      (operation.kind === "mcp-tool" ||
        (operation.turnId !== null && request.turnId === operation.turnId));
    if (!matches) return;
    if (operation.kind === "mcp-tool" && operation.turnId === null) {
      operation.turnId = request.turnId;
    }
    pending.operationToken = operation.token;
    if (!pending.reported) {
      pending.reported = true;
      this.enqueueOperationResult(operation, {
        value: {
          status: "approval-needed",
          transport: operation.kind,
          threadId: operation.threadId,
          turnId: operation.turnId ?? request.turnId,
          approval: request,
        },
      });
    }
  }

  private surfacePendingApprovals(operation: ActiveOperation) {
    for (const pending of Array.from(this.pendingApprovals.values())) {
      if (pending.operationToken === null || pending.operationToken === operation.token) {
        this.attachApproval(pending);
      }
    }
  }

  private removeQueuedApproval(operation: ActiveOperation, requestId: CodexJsonRpcId) {
    const key = rpcIdKey(requestId);
    operation.queue = operation.queue.filter((entry) => {
      const value = entry.value;
      return !(
        value?.status === "approval-needed" &&
        rpcIdKey(value.approval.requestId) === key
      );
    });
  }

  private clearApprovalsForOperation(operation: ActiveOperation) {
    for (const [key, pending] of Array.from(this.pendingApprovals.entries())) {
      if (pending.operationToken === operation.token) this.pendingApprovals.delete(key);
    }
    operation.queue = operation.queue.filter(
      (entry) => entry.value?.status !== "approval-needed",
    );
  }

  private replayEarlyTurnEvents(operation: ActiveOperation) {
    if (!operation.turnId) return;
    const events = this.earlyTurnEvents.get(operation.turnId) ?? [];
    this.earlyTurnEvents.delete(operation.turnId);
    for (const event of events) {
      this.processTurnEvent(operation, event.method, event.params);
    }
  }

  private beginRequest(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number | null = this.requestTimeoutMs,
    allowBeforeReady = false,
  ) {
    if (!allowBeforeReady) this.assertReady();
    if (this.fatalError) throw this.fatalError;
    const id = this.nextRpcId++;
    let resolvePromise!: (value: unknown) => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<unknown>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const pending: PendingRpc = {
      method,
      resolve: resolvePromise,
      reject: rejectPromise,
      timer: null,
    };
    if (timeoutMs !== null) {
      pending.timer = setTimeout(() => {
        if (!this.pendingRpc.delete(id)) return;
        rejectPromise(new CodexAppServerTimeoutError(method, timeoutMs));
      }, timeoutMs);
      pending.timer.unref?.();
    }
    this.pendingRpc.set(id, pending);
    void this.writeMessage({ method, id, params }).catch((error) => {
      const current = this.pendingRpc.get(id);
      if (!current) return;
      this.pendingRpc.delete(id);
      if (current.timer) clearTimeout(current.timer);
      current.reject(error instanceof Error ? error : new CodexAppServerError(String(error)));
    });
    return { id, promise };
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number | null = this.requestTimeoutMs,
    allowBeforeReady = false,
  ) {
    return this.beginRequest(method, params, timeoutMs, allowBeforeReady).promise;
  }

  private writeMessage(message: Record<string, unknown>): Promise<void> {
    if (this.processExited || this.process.stdin.destroyed || !this.process.stdin.writable) {
      return Promise.reject(
        this.fatalError ??
          new CodexAppServerProcessError("Codex app-server stdin is not writable.", {
            stderr: this.stderrTail,
          }),
      );
    }
    let serialized: string;
    try {
      serialized = `${JSON.stringify(message)}\n`;
    } catch (error) {
      return Promise.reject(
        new CodexAppServerProtocolError(
          `Could not serialize app-server message: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
    return new Promise((resolve, reject) => {
      this.process.stdin.write(serialized, (error) => {
        if (error) {
          reject(
            new CodexAppServerProcessError(
              `Could not write to Codex app-server: ${error.message}`,
              { stderr: this.stderrTail },
            ),
          );
        } else {
          resolve();
        }
      });
    });
  }

  private failConnection(error: Error, kill: boolean) {
    if (this.fatalError) return;
    this.fatalError = error;
    this.connectionState = "failed";
    this.failOutstanding(error);
    if (kill && !this.processExited) this.process.kill("SIGTERM");
  }

  private failOutstanding(error: Error) {
    for (const pending of Array.from(this.pendingRpc.values())) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRpc.clear();
    if (this.activeOperation) {
      this.failOperation(this.activeOperation, error);
    }
    this.pendingApprovals.clear();
  }

  private assertReady() {
    if (this.fatalError) throw this.fatalError;
    if (this.connectionState !== "ready") {
      throw new CodexAppServerStateError(
        `Codex app-server client is ${this.connectionState}, not ready.`,
      );
    }
  }

  private assertNoActiveOperation() {
    if (this.activeOperation && !this.activeOperation.finished) {
      throw new CodexAppServerStateError(
        "The dedicated connector thread already has an active operation.",
      );
    }
  }

  private requireThreadId() {
    if (!this._dedicatedThreadId) {
      throw new CodexAppServerStateError(
        "Start or resume the dedicated connector thread first.",
      );
    }
    return this._dedicatedThreadId;
  }

  private versionError(method: string, feature: string) {
    this.methodStates[method] = "unsupported";
    this.addCompatibilityWarning(`${method} is unavailable on this Codex version.`);
    return new CodexAppServerVersionError(
      method,
      feature,
      this.initializeResult?.userAgent ?? null,
    );
  }

  private addCompatibilityWarning(message: string) {
    if (!this.compatibilityWarnings.includes(message)) {
      this.compatibilityWarnings.push(message);
    }
  }
}

function parseRpcError(value: Record<string, unknown>): JsonRpcResponseError {
  return {
    code: typeof value.code === "number" ? value.code : -32000,
    message: asString(value.message) ?? "Unknown JSON-RPC error",
    data: value.data,
  };
}

function parseThreadId(raw: unknown, method: string) {
  if (!isRecord(raw) || !isRecord(raw.thread) || typeof raw.thread.id !== "string") {
    throw new CodexAppServerProtocolError(`${method} returned an invalid response.`);
  }
  return raw.thread.id;
}

function normalizeAuthStatus(value: unknown): CodexMcpAuthStatus {
  if (
    value === "unsupported" ||
    value === "notLoggedIn" ||
    value === "bearerToken" ||
    value === "oAuth"
  ) {
    return value;
  }
  return "unknown";
}

function parseApprovalRequest(
  requestId: CodexJsonRpcId,
  method: CodexUserInputApproval["method"],
  params: Record<string, unknown>,
): CodexUserInputApproval {
  const threadId = asString(params.threadId);
  const itemId = asString(params.itemId);
  if (!threadId || !itemId || !Array.isArray(params.questions)) {
    throw new CodexAppServerProtocolError(
      `${method} omitted threadId, itemId, or questions.`,
    );
  }
  const questions = params.questions.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new CodexAppServerProtocolError(
        `${method} question ${index + 1} is invalid.`,
      );
    }
    const id = asString(raw.id);
    const header = asString(raw.header);
    const question = asString(raw.question);
    if (!id || !header || !question) {
      throw new CodexAppServerProtocolError(
        `${method} question ${index + 1} omitted id, header, or question.`,
      );
    }
    const options = Array.isArray(raw.options)
      ? raw.options.flatMap((option) => {
          if (!isRecord(option)) return [];
          const label = asString(option.label);
          const description = asString(option.description);
          return label && description ? [{ label, description }] : [];
        })
      : [];
    return {
      id,
      header,
      question,
      options,
      isOther: raw.isOther === true,
      isSecret: raw.isSecret === true,
    };
  });
  const autoResolutionMs =
    typeof params.autoResolutionMs === "number" &&
    Number.isSafeInteger(params.autoResolutionMs) &&
    params.autoResolutionMs >= 0
      ? params.autoResolutionMs
      : null;
  return {
    requestId,
    method,
    threadId,
    turnId: asString(params.turnId),
    itemId,
    questions,
    autoResolutionMs,
  };
}

function validateApprovalAnswers(
  approval: CodexUserInputApproval,
  answers: CodexApprovalAnswers,
) {
  if (!isRecord(answers)) {
    throw new CodexAppServerStateError("Approval answers must be an object.");
  }
  const expected = new Set(approval.questions.map((question) => question.id));
  for (const id of Object.keys(answers)) {
    if (!expected.has(id)) {
      throw new CodexAppServerStateError(`Unknown approval question id: ${id}.`);
    }
  }
  const result: Record<string, { answers: string[] }> = {};
  for (const question of approval.questions) {
    const selected = answers[question.id];
    if (!Array.isArray(selected) || selected.length === 0) {
      throw new CodexAppServerStateError(
        `Approval question ${question.id} requires an explicit answer.`,
      );
    }
    const normalized = selected.map((answer) => validateIdentifier(answer, "Approval answer"));
    result[question.id] = { answers: normalized };
  }
  return result;
}

function parseMcpToolResult<T>(raw: unknown): CodexMcpToolResult<T> {
  if (!isRecord(raw) || !Array.isArray(raw.content)) {
    throw new CodexAppServerProtocolError(
      "mcpServer/tool/call returned an invalid response.",
    );
  }
  const content = raw.content.map((item) => {
    const value = asJsonValue(item);
    if (value === null && item !== null) {
      throw new CodexAppServerProtocolError(
        "mcpServer/tool/call returned non-JSON content.",
      );
    }
    return value;
  });
  return {
    content,
    structuredContent:
      raw.structuredContent === undefined
        ? null
        : (asJsonValue(raw.structuredContent) as T | null),
    isError: raw.isError === true,
    meta: raw._meta === undefined ? null : asJsonValue(raw._meta),
  };
}
