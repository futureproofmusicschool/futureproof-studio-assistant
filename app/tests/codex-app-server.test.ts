import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CodexAppServerClient,
  CodexAppServerProcessError,
  CodexAppServerRpcError,
  CodexAppServerStateError,
  CodexAppServerTimeoutError,
} from "../lib/connectors/codex-app-server";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "fake-codex-app-server.mjs",
);

function connect(
  scenario = "normal",
  options: Parameters<typeof CodexAppServerClient.connect>[0] = {},
) {
  return CodexAppServerClient.connect({
    command: process.execPath,
    args: [fixture, scenario],
    startupTimeoutMs: 2_000,
    requestTimeoutMs: 1_000,
    turnTimeoutMs: 2_000,
    closeTimeoutMs: 500,
    ...options,
  });
}

test("initializes in protocol order and discovers paginated app status/install URLs", async () => {
  const client = await connect();
  try {
    const apps = await client.discoverApps({ forceRefresh: true });
    assert.deepEqual(apps.map((app) => app.id), ["google_drive", "gmail", "google_sheets"]);
    assert.deepEqual(
      apps.find((app) => app.id === "google_drive"),
      {
        id: "google_drive",
        name: "Google Drive",
        description: "Drive connector",
        installUrl: "https://chatgpt.com/apps/google-drive/google-drive",
        accessible: true,
        enabled: true,
        installed: true,
        callable: true,
        runtimeName: "Google Drive",
        status: "callable",
      },
    );
    assert.equal(apps.find((app) => app.id === "gmail")?.status, "not-installed");
    assert.equal(apps.find((app) => app.id === "google_sheets")?.status, "disabled");
    const capabilities = client.getCapabilities();
    assert.equal(capabilities.connectionState, "ready");
    assert.equal(capabilities.server?.userAgent, "fake-codex/1.0.0");
    assert.equal(capabilities.serverMethods["app/list"], "supported");
    assert.equal(capabilities.serverMethods["app/installed"], "supported");
    assert.equal(capabilities.client.automaticApproval, false);
  } finally {
    await client.close();
  }
});

test("degrades safely when a newer app status method is unavailable", async () => {
  const client = await connect("legacy");
  try {
    const apps = await client.discoverApps();
    const drive = apps.find((app) => app.id === "google_drive");
    assert.equal(drive?.installed, null);
    assert.equal(drive?.callable, null);
    assert.equal(drive?.status, "unknown");
    const capabilities = client.getCapabilities();
    assert.equal(capabilities.serverMethods["app/installed"], "unsupported");
    assert.match(capabilities.compatibilityWarnings.join(" "), /installed.*unknown/i);
  } finally {
    await client.close();
  }
});

test("discovers exact MCP schemas and enforces the direct-call allowlist", async () => {
  const client = await connect("normal", {
    allowedMcpTools: [
      { server: "codex_apps", tool: "google_drive.create_file" },
    ],
  });
  try {
    await client.startDedicatedThread();
    const inventory = await client.discoverTools();
    assert.equal(inventory.servers[0]?.authStatus, "oAuth");
    assert.deepEqual(
      inventory.tools.map((tool) => tool.name),
      ["google_drive.create_file", "gmail.create_draft", "gmail.send_email"],
    );
    assert.deepEqual(
      inventory.tools.find((tool) => tool.name === "google_drive.create_file")
        ?.inputSchema,
      { type: "object", properties: { name: { type: "string" } } },
    );

    await assert.rejects(
      client.callMcpTool({ server: "codex_apps", tool: "gmail.send_email" }),
      (error: unknown) =>
        error instanceof CodexAppServerStateError && /exact allowlist/.test(error.message),
    );

    const outcome = await client.callMcpTool<{ created: boolean; fileId: string }>({
      server: "codex_apps",
      tool: "google_drive.create_file",
      arguments: { name: "Plan" },
    });
    assert.equal(outcome.status, "completed");
    if (outcome.status === "completed") {
      assert.deepEqual(outcome.value.structuredContent, {
        created: true,
        fileId: "file-1",
      });
      assert.equal(outcome.value.isError, false);
    }
  } finally {
    await client.close();
  }
});

test("returns direct MCP approval as data and continues only after an explicit answer", async () => {
  const client = await connect("normal", {
    allowedMcpTools: [
      { server: "codex_apps", tool: "google_drive.create_file" },
    ],
  });
  try {
    await client.startDedicatedThread();
    const first = await client.callMcpTool({
      server: "codex_apps",
      tool: "google_drive.create_file",
      arguments: { name: "Plan", requireApproval: true },
    });
    assert.equal(first.status, "approval-needed");
    if (first.status !== "approval-needed") return;
    assert.equal(first.approval.questions[0]?.question, "Create this Google item?");
    assert.equal(client.listPendingApprovals().length, 1);

    const completed = await client.respondToApproval<{
      content: unknown[];
      structuredContent: { created: boolean; fileId: string } | null;
      isError: boolean;
      meta: unknown;
    }>(first.approval.requestId, { decision: ["Accept"] });
    assert.equal(completed.status, "completed");
    if (completed.status === "completed") {
      assert.deepEqual(completed.value.structuredContent, {
        created: true,
        fileId: "file-1",
      });
    }
    assert.equal(client.listPendingApprovals().length, 0);
  } finally {
    await client.close();
  }
});

test("starts or resumes a dedicated thread and invokes an app with a mention and schema", async () => {
  const client = await connect();
  try {
    assert.equal(await client.resumeDedicatedThread("saved-thread"), "saved-thread");
    assert.equal(client.dedicatedThreadId, "saved-thread");
    const outcome = await client.invokeApp<{
      ok: boolean;
      mentionPath: string;
      hasOutputSchema: boolean;
    }>({
      app: { id: "google_drive", name: "Google Drive" },
      prompt: "Create a planning document",
      outputSchema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          mentionPath: { type: "string" },
          hasOutputSchema: { type: "boolean" },
        },
        required: ["ok", "mentionPath", "hasOutputSchema"],
        additionalProperties: false,
      },
    });
    assert.equal(outcome.status, "completed");
    if (outcome.status === "completed") {
      assert.deepEqual(outcome.value.data, {
        ok: true,
        mentionPath: "app://google_drive",
        hasOutputSchema: true,
      });
      assert.equal(outcome.value.toolCalls[0]?.tool, "google_drive.create_file");
    }
    await assert.rejects(
      client.resumeDedicatedThread("missing"),
      (error: unknown) =>
        error instanceof CodexAppServerRpcError && /Thread not found/.test(error.message),
    );
  } finally {
    await client.close();
  }
});

test("surfaces app-turn approval and accepts the documented legacy method spelling", async () => {
  const client = await connect("legacy-approval-method");
  try {
    await client.startDedicatedThread();
    const first = await client.invokeApp({
      app: { id: "google_drive", name: "Google Drive" },
      prompt: "REQUIRE_APPROVAL before creating a document",
      outputSchema: { type: "object" },
    });
    assert.equal(first.status, "approval-needed");
    if (first.status !== "approval-needed") return;
    assert.equal(first.approval.method, "tool/requestUserInput");
    const second = await client.respondToApproval(first.approval.requestId, {
      decision: ["Accept"],
    });
    assert.equal(second.status, "completed");
  } finally {
    await client.close();
  }
});

test("rejects request timeouts and unexpected process exits with typed errors", async (t) => {
  await t.test("request timeout", async () => {
    const client = await connect("hang-list", { requestTimeoutMs: 50 });
    try {
      await assert.rejects(
        client.discoverApps(),
        (error: unknown) =>
          error instanceof CodexAppServerTimeoutError && error.operation === "app/list",
      );
    } finally {
      await client.close();
    }
  });

  await t.test("process exit", async () => {
    const client = await connect("exit-on-list");
    try {
      await assert.rejects(
        client.discoverApps(),
        (error: unknown) =>
          error instanceof CodexAppServerProcessError && error.exitCode === 17,
      );
    } finally {
      await client.close();
    }
  });
});
