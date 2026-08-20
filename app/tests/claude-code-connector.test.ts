import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAUDE_CONNECTORS_INSTALL_URL,
  ClaudeConnectorError,
  assertSafeConnectorOperation,
  claudeAiConnectorEnvironment,
  connectorAllowedToolPatterns,
  connectorDeniedToolPatterns,
  inspectClaudeCodeConnectors,
  invokeClaudeConnectorOperation,
  mcpServerToolPrefix,
  parseClaudeMcpList,
  type ClaudeCommandOptions,
  type ClaudeCommandResult,
  type ClaudeCommandRunner,
} from "../lib/connectors/claude-code";

const connectedList = [
  "Checking MCP server health...",
  "local Gmail: https://example.test/mcp - ✔ Connected",
  "claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected",
  "claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ✓ Connected",
].join("\n");

function result(stdout = "", overrides: Partial<ClaudeCommandResult> = {}): ClaudeCommandResult {
  return { stdout, stderr: "", exitCode: 0, signal: null, timedOut: false, ...overrides };
}

function queuedRunner(
  results: Array<ClaudeCommandResult | Error>,
  calls: Array<{ binary: string; args: readonly string[]; options: ClaudeCommandOptions }> = [],
): ClaudeCommandRunner {
  return async (binary, args, options) => {
    calls.push({ binary, args, options });
    const next = results.shift();
    if (!next) throw new Error("Unexpected Claude CLI call.");
    if (next instanceof Error) throw next;
    return next;
  };
}

test("parses only connected claude.ai Gmail and Google Drive MCP entries", () => {
  const connectors = parseClaudeMcpList(connectedList);
  assert.deepEqual(
    connectors.map(({ kind, state, connected, url }) => ({ kind, state, connected, url })),
    [
      {
        kind: "gmail",
        state: "connected",
        connected: true,
        url: "https://gmailmcp.googleapis.com/mcp/v1",
      },
      {
        kind: "google-drive",
        state: "connected",
        connected: true,
        url: "https://drivemcp.googleapis.com/mcp/v1",
      },
    ],
  );
});

test("distinguishes reauthentication, pending approval, and failed connector health", () => {
  assert.equal(parseClaudeMcpList("claude.ai Gmail: https://gmail.test - △ needs authentication")[0].state, "needs-authentication");
  assert.equal(parseClaudeMcpList("claude.ai Gmail: https://gmail.test - pending approval")[0].state, "pending");
  assert.equal(parseClaudeMcpList("claude.ai Google Drive: https://drive.test - ✗ Failed to connect")[0].state, "failed");
});

test("builds exact Claude MCP prefixes and server-scoped allow/deny patterns", () => {
  assert.equal(mcpServerToolPrefix("claude.ai Google Drive"), "mcp__claude_ai_Google_Drive");
  assert.deepEqual(connectorAllowedToolPatterns(["gmail"]), ["mcp__claude_ai_Gmail__*"]);
  const denied = connectorDeniedToolPatterns(["gmail", "google-drive"]);
  for (const prefix of ["mcp__claude_ai_Gmail", "mcp__claude_ai_Google_Drive"]) {
    for (const action of ["send", "forward", "reply", "delete", "trash", "share"]) {
      assert.ok(denied.includes(`${prefix}__*${action}*`));
    }
  }
});

test("rejects externally visible/destructive operations but permits drafts and reads", () => {
  assert.doesNotThrow(() => assertSafeConnectorOperation("gmail.create_draft"));
  assert.doesNotThrow(() => assertSafeConnectorOperation("drive.read_document"));
  for (const action of ["sendEmail", "forward_message", "reply-to-thread", "delete file", "trash", "shareDocument"]) {
    assert.throws(
      () => assertSafeConnectorOperation(action),
      (error: unknown) => error instanceof ClaudeConnectorError && error.code === "UNSAFE_OPERATION",
    );
  }
});

test("removes API/provider mode variables from the Claude.ai connector environment", () => {
  const env = claudeAiConnectorEnvironment({
    ANTHROPIC_API_KEY: "secret",
    ANTHROPIC_AUTH_TOKEN: "secret",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_USE_VERTEX: "1",
    CLAUDE_CODE_USE_FOUNDRY: "1",
  });
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.equal(env.CLAUDE_CODE_USE_VERTEX, undefined);
  assert.equal(env.CLAUDE_CODE_USE_FOUNDRY, undefined);
  assert.equal(env.ENABLE_CLAUDEAI_MCP_SERVERS, "true");
});

test("inspection captures the binary version and connected Claude.ai connectors", async () => {
  const calls: Array<{ binary: string; args: readonly string[]; options: ClaudeCommandOptions }> = [];
  const runner = queuedRunner([
    result("2.1.226 (Claude Code)\n"),
    result(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" })),
    result(connectedList),
  ], calls);
  const inspection = await inspectClaudeCodeConnectors({ binary: "/opt/bin/claude", runner });
  assert.equal(inspection.available, true);
  assert.equal(inspection.binary, "/opt/bin/claude");
  assert.equal(inspection.version, "2.1.226 (Claude Code)");
  assert.equal(inspection.authentication, "claude-ai");
  assert.equal(inspection.connectors.gmail?.connected, true);
  assert.equal(inspection.connectors["google-drive"]?.connected, true);
  assert.deepEqual(calls.map((call) => call.args), [["--version"], ["auth", "status", "--json"], ["mcp", "list"]]);
});

test("inspection reports missing Claude Code and disconnected accounts clearly", async () => {
  const missing = await inspectClaudeCodeConnectors({
    binary: "claude",
    runner: queuedRunner([Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })]),
  });
  assert.equal(missing.error?.code, "CLAUDE_NOT_INSTALLED");

  const signedOut = await inspectClaudeCodeConnectors({
    binary: "claude",
    runner: queuedRunner([
      result("2.1.226"),
      result(JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" }), { exitCode: 1 }),
      result("Checking MCP server health..."),
    ]),
  });
  assert.equal(signedOut.error?.code, "CLAUDE_NOT_AUTHENTICATED");
  assert.match(signedOut.error?.message ?? "", /Claude\.ai subscription/);
});

test("invokes structured output with built-ins disabled and connector tools bounded", async () => {
  const calls: Array<{ binary: string; args: readonly string[]; options: ClaudeCommandOptions }> = [];
  const runner = queuedRunner([
    result("2.1.226"),
    result(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" })),
    result(connectedList),
    result(JSON.stringify({ structured_output: { draftId: "draft-1" }, session_id: "session-1", duration_ms: 321 })),
  ], calls);
  const response = await invokeClaudeConnectorOperation<{ draftId: string }>(
    {
      action: "gmail.create_draft",
      prompt: "Create a reviewable Gmail draft from the supplied fields.",
      input: { to: "artist@example.com", subject: "Mix notes", body: "Here are the notes." },
      connectors: ["gmail"],
      allowedTools: ["mcp__claude_ai_Gmail__gmail_create_draft"],
      jsonSchema: {
        type: "object",
        properties: { draftId: { type: "string" } },
        required: ["draftId"],
        additionalProperties: false,
      },
      timeoutMs: 12_000,
    },
    {
      binary: "/opt/bin/claude",
      runner,
      env: { ANTHROPIC_API_KEY: "must-not-leak", CLAUDE_CODE_USE_VERTEX: "1" },
    },
  );

  assert.deepEqual(response, {
    data: { draftId: "draft-1" },
    connectorKinds: ["gmail"],
    sessionId: "session-1",
    durationMs: 321,
  });
  const invocation = calls[3];
  assert.deepEqual(invocation.args.slice(0, 3), ["-p", "--output-format", "json"]);
  assert.equal(invocation.args[invocation.args.indexOf("--tools") + 1], "");
  assert.equal(invocation.args[invocation.args.indexOf("--setting-sources") + 1], "user,project,local");
  assert.equal(invocation.args[invocation.args.indexOf("--permission-mode") + 1], "dontAsk");
  assert.equal(
    invocation.args[invocation.args.indexOf("--allowedTools") + 1],
    "mcp__claude_ai_Gmail__gmail_create_draft",
  );
  const denied = invocation.args[invocation.args.indexOf("--disallowedTools") + 1];
  assert.match(denied, /mcp__claude_ai_Gmail__\*send\*/);
  assert.match(denied, /mcp__claude_ai_Gmail__\*share\*/);
  assert.ok(!invocation.args.includes("--dangerously-skip-permissions"));
  assert.ok(!invocation.args.includes("--bare"));
  assert.equal(invocation.options.timeoutMs, 12_000);
  assert.equal(invocation.options.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(invocation.options.env.CLAUDE_CODE_USE_VERTEX, undefined);
  assert.equal(invocation.options.env.ENABLE_CLAUDEAI_MCP_SERVERS, "true");
  assert.match(invocation.options.stdin ?? "", /Never send, forward, or reply/);
  assert.match(invocation.options.stdin ?? "", /artist@example\.com/);
});

test("rejects tools outside the selected server and banned action tools before spawning", async () => {
  let calls = 0;
  const runner: ClaudeCommandRunner = async () => {
    calls += 1;
    return result();
  };
  await assert.rejects(
    invokeClaudeConnectorOperation(
      {
        action: "gmail.create_draft",
        prompt: "Create a draft.",
        connectors: ["gmail"],
        allowedTools: ["mcp__claude_ai_Google_Drive__search"],
        jsonSchema: { type: "object" },
      },
      { binary: "claude", runner },
    ),
    (error: unknown) => error instanceof ClaudeConnectorError && error.code === "INVALID_OPERATION",
  );
  await assert.rejects(
    invokeClaudeConnectorOperation(
      {
        action: "gmail.create_draft",
        prompt: "Create a draft.",
        connectors: ["gmail"],
        allowedTools: ["mcp__claude_ai_Gmail__send_email"],
        jsonSchema: { type: "object" },
      },
      { binary: "claude", runner },
    ),
    (error: unknown) => error instanceof ClaudeConnectorError && error.code === "UNSAFE_OPERATION",
  );
  await assert.rejects(
    invokeClaudeConnectorOperation(
      {
        action: "gmail.create_draft",
        prompt: "Create a draft.",
        connectors: ["gmail"],
        allowedTools: ["mcp__claude_ai_Gmail__*"],
        jsonSchema: { type: "object" },
      },
      { binary: "claude", runner },
    ),
    (error: unknown) => error instanceof ClaudeConnectorError && error.code === "INVALID_OPERATION",
  );
  assert.equal(calls, 0);
});

test("classifies reauthentication, permission denial, and timeout failures", async () => {
  const inspectResults = () => [
    result("2.1.226"),
    result(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" })),
    result(connectedList),
  ];
  const operation = {
    action: "drive.read_document",
    prompt: "Read the named document.",
    input: { id: "document-1" },
    connectors: ["google-drive"] as const,
    allowedTools: ["mcp__claude_ai_Google_Drive__google_drive_get_document"] as const,
    jsonSchema: { type: "object" },
  };

  await assert.rejects(
    invokeClaudeConnectorOperation(operation, {
      binary: "claude",
      runner: queuedRunner([...inspectResults(), result("", { exitCode: 1, stderr: "OAuth token expired; re-authentication required" })]),
    }),
    (error: unknown) =>
      error instanceof ClaudeConnectorError &&
      error.code === "CONNECTOR_REAUTH_REQUIRED" &&
      error.installUrl === CLAUDE_CONNECTORS_INSTALL_URL,
  );
  await assert.rejects(
    invokeClaudeConnectorOperation(operation, {
      binary: "claude",
      runner: queuedRunner([...inspectResults(), result("", { exitCode: 1, stderr: "Permission denied by connector" })]),
    }),
    (error: unknown) => error instanceof ClaudeConnectorError && error.code === "CONNECTOR_PERMISSION_DENIED",
  );
  await assert.rejects(
    invokeClaudeConnectorOperation(operation, {
      binary: "claude",
      runner: queuedRunner([...inspectResults(), result("", { exitCode: null, signal: "SIGKILL", timedOut: true })]),
    }),
    (error: unknown) => error instanceof ClaudeConnectorError && error.code === "CONNECTOR_TIMEOUT",
  );
});

test("preserves connector permission failures raised while listing MCP health", async () => {
  const runner = queuedRunner([
    result("2.1.226"),
    result("not supported", { exitCode: 1 }),
    result("", { exitCode: 1, stderr: "Access denied: connector permission denied" }),
  ]);
  await assert.rejects(
    invokeClaudeConnectorOperation(
      {
        action: "gmail.search",
        prompt: "Search mail metadata.",
        connectors: ["gmail"],
        allowedTools: ["mcp__claude_ai_Gmail__gmail_search"],
        jsonSchema: { type: "object" },
      },
      { binary: "claude", runner },
    ),
    (error: unknown) => error instanceof ClaudeConnectorError && error.code === "CONNECTOR_PERMISSION_DENIED",
  );
});
