import readline from "node:readline";

const scenario = process.argv[2] ?? "normal";
const input = readline.createInterface({ input: process.stdin });

let initializeAnswered = false;
let initialized = false;
let nextThread = 1;
let nextTurn = 1;
let pendingApproval = null;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function rpcError(id, code, message) {
  send({ id, error: { code, message } });
}

function assertInitialized(message) {
  if (initialized) return true;
  rpcError(message.id, -32002, "Not initialized");
  return false;
}

function completeTurn(threadId, turnId, turnParams) {
  const mention = Array.isArray(turnParams.input)
    ? turnParams.input.find((item) => item?.type === "mention")
    : null;
  const agentItem = {
    id: `agent-${turnId}`,
    type: "agentMessage",
    phase: "final_answer",
    text: JSON.stringify({
      ok: true,
      mentionPath: mention?.path ?? null,
      hasOutputSchema: Boolean(turnParams.outputSchema),
    }),
  };
  const toolItem = {
    id: `tool-${turnId}`,
    type: "mcpToolCall",
    server: "codex_apps",
    tool: "google_drive.create_file",
    status: "completed",
    arguments: {},
    result: { structuredContent: { fileId: "file-1" } },
    error: null,
  };
  send({
    method: "item/completed",
    params: { threadId, turnId, item: toolItem, completedAtMs: Date.now() },
  });
  send({
    method: "item/completed",
    params: { threadId, turnId, item: agentItem, completedAtMs: Date.now() },
  });
  send({
    method: "turn/completed",
    params: {
      threadId,
      turn: { id: turnId, status: "completed", items: [toolItem, agentItem], error: null },
    },
  });
}

function requestApproval({ id, threadId, turnId, kind, turnParams }) {
  const requestId = kind === "turn" ? "turn-approval" : "mcp-approval";
  pendingApproval = { id, threadId, turnId, kind, turnParams, requestId };
  send({
    method: scenario === "legacy-approval-method"
      ? "tool/requestUserInput"
      : "item/tool/requestUserInput",
    id: requestId,
    params: {
      threadId,
      turnId,
      itemId: `${kind}-approval-item`,
      autoResolutionMs: null,
      questions: [
        {
          id: "decision",
          header: "Approval",
          question: "Create this Google item?",
          options: [
            { label: "Accept", description: "Create the item." },
            { label: "Decline", description: "Do not create the item." },
            { label: "Cancel", description: "Cancel the operation." },
          ],
        },
      ],
    },
  });
}

function handleApprovalResponse(message) {
  if (!pendingApproval || message.id !== pendingApproval.requestId) return false;
  const selected = message.result?.answers?.decision?.answers ?? [];
  send({
    method: "serverRequest/resolved",
    params: { threadId: pendingApproval.threadId, requestId: pendingApproval.requestId },
  });
  const approved = selected.includes("Accept");
  if (pendingApproval.kind === "mcp") {
    send({
      id: pendingApproval.id,
      result: {
        content: [{ type: "text", text: approved ? "created" : "not created" }],
        structuredContent: { created: approved, fileId: approved ? "file-1" : null },
        isError: !approved,
      },
    });
  } else if (approved) {
    completeTurn(
      pendingApproval.threadId,
      pendingApproval.turnId,
      pendingApproval.turnParams,
    );
  } else {
    send({
      method: "turn/completed",
      params: {
        threadId: pendingApproval.threadId,
        turn: {
          id: pendingApproval.turnId,
          status: "failed",
          items: [],
          error: { message: "User declined connector action" },
        },
      },
    });
  }
  pendingApproval = null;
  return true;
}

input.on("line", (line) => {
  const message = JSON.parse(line);
  if (handleApprovalResponse(message)) return;

  if (message.method === "initialize") {
    if (initializeAnswered) {
      rpcError(message.id, -32000, "Already initialized");
      return;
    }
    initializeAnswered = true;
    send({
      id: message.id,
      result: {
        codexHome: "/tmp/fake-codex-home",
        platformFamily: "unix",
        platformOs: "macos",
        userAgent: "fake-codex/1.0.0",
      },
    });
    return;
  }

  if (message.method === "initialized") {
    if (!initializeAnswered) {
      process.stderr.write("initialized arrived before initialize response\n");
      process.exit(91);
    }
    initialized = true;
    return;
  }

  if (!assertInitialized(message)) return;

  if (message.method === "app/list") {
    if (scenario === "exit-on-list") {
      process.stderr.write("intentional app/list exit\n");
      process.exit(17);
    }
    if (scenario === "hang-list") return;
    if (message.params?.cursor === "page-2") {
      send({
        id: message.id,
        result: {
          data: [
            {
              id: "google_sheets",
              name: "Google Sheets",
              description: "Sheets connector",
              installUrl: null,
              isAccessible: true,
              isEnabled: false,
            },
          ],
          nextCursor: null,
        },
      });
      return;
    }
    send({
      id: message.id,
      result: {
        data: [
          {
            id: "google_drive",
            name: "Google Drive",
            description: "Drive connector",
            installUrl: "https://chatgpt.com/apps/google-drive/google-drive",
            isAccessible: true,
            isEnabled: true,
          },
          {
            id: "gmail",
            name: "Gmail",
            description: "Gmail connector",
            installUrl: "https://chatgpt.com/apps/gmail/gmail",
            isAccessible: false,
            isEnabled: true,
          },
        ],
        nextCursor: "page-2",
      },
    });
    return;
  }

  if (message.method === "app/installed") {
    if (scenario === "legacy") {
      rpcError(
        message.id,
        -32600,
        "Invalid request: unknown variant `app/installed`",
      );
      return;
    }
    send({
      id: message.id,
      result: {
        apps: [
          {
            id: "google_drive",
            runtimeName: "Google Drive",
            enabled: true,
            callable: true,
          },
        ],
      },
    });
    return;
  }

  if (message.method === "thread/start") {
    const threadId = `thread-${nextThread++}`;
    send({ id: message.id, result: { thread: { id: threadId, sessionId: threadId } } });
    return;
  }

  if (message.method === "thread/resume") {
    if ("ephemeral" in message.params || "serviceName" in message.params) {
      rpcError(message.id, -32602, "thread/resume received start-only fields");
      return;
    }
    if (message.params?.threadId === "missing") {
      rpcError(message.id, -32000, "Thread not found");
      return;
    }
    send({
      id: message.id,
      result: { thread: { id: message.params?.threadId, sessionId: message.params?.threadId } },
    });
    return;
  }

  if (message.method === "mcpServerStatus/list") {
    send({
      id: message.id,
      result: {
        data: [
          {
            name: "codex_apps",
            authStatus: "oAuth",
            serverInfo: {
              name: "Codex Apps",
              title: "Codex Apps",
              version: "1.0.0",
              description: "Installed app tools",
            },
            tools: {
              "google_drive.create_file": {
                name: "google_drive.create_file",
                title: "Create file",
                description: "Create a Google Drive file",
                inputSchema: { type: "object", properties: { name: { type: "string" } } },
                outputSchema: { type: "object" },
              },
              "gmail.create_draft": {
                name: "gmail.create_draft",
                title: "Create draft",
                description: "Create an unsent Gmail draft",
                inputSchema: { type: "object" },
              },
              "gmail.send_email": {
                name: "gmail.send_email",
                title: "Send email",
                description: "Send an email",
                inputSchema: { type: "object" },
              },
            },
            resources: [],
            resourceTemplates: [],
          },
        ],
        nextCursor: null,
      },
    });
    return;
  }

  if (message.method === "mcpServer/tool/call") {
    if (message.params?.tool === "gmail.send_email") {
      process.stderr.write("unsafe send tool reached fake server\n");
      process.exit(92);
    }
    if (message.params?.arguments?.requireApproval === true) {
      requestApproval({
        id: message.id,
        threadId: message.params.threadId,
        turnId: "direct-tool-turn",
        kind: "mcp",
      });
      return;
    }
    send({
      id: message.id,
      result: {
        content: [{ type: "text", text: "created" }],
        structuredContent: { created: true, fileId: "file-1" },
        isError: false,
      },
    });
    return;
  }

  if (message.method === "turn/start") {
    const turnId = `turn-${nextTurn++}`;
    send({
      id: message.id,
      result: { turn: { id: turnId, status: "inProgress", items: [], error: null } },
    });
    const text = message.params?.input?.find((item) => item?.type === "text")?.text ?? "";
    if (text.includes("REQUIRE_APPROVAL")) {
      requestApproval({
        id: message.id,
        threadId: message.params.threadId,
        turnId,
        kind: "turn",
        turnParams: message.params,
      });
    } else {
      completeTurn(message.params.threadId, turnId, message.params);
    }
    return;
  }

  if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    send({
      method: "turn/completed",
      params: {
        threadId: message.params.threadId,
        turn: {
          id: message.params.turnId,
          status: "interrupted",
          items: [],
          error: null,
        },
      },
    });
    return;
  }

  rpcError(message.id, -32601, `Method not found: ${message.method}`);
});
