import { query } from "@anthropic-ai/claude-agent-sdk";
import { bus } from "../bus/eventBus.js";
import { projectManager } from "./projects.js";
import { permissionManager } from "./permissions.js";
import type {
  ClaudeCodeRequest,
  ClaudeCodePermissionRequest,
  ClaudeCodePermissionResponse,
} from "./types.js";

// Map of pending permission requests
const pendingPermissions = new Map<
  string,
  {
    resolve: (result: { approved: boolean; remember: boolean }) => void;
  }
>();

// Active sessions per chat+project
const activeSessions = new Map<string, string>();

class ClaudeCodeExecutor {
  constructor() {
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle incoming Claude Code requests
    bus.subscribe("claude-code:request", async (request: ClaudeCodeRequest) => {
      await this.executeRequest(request);
    });

    // Handle permission responses from user
    bus.subscribe(
      "claude-code:permission-response",
      (response: ClaudeCodePermissionResponse) => {
        const pending = pendingPermissions.get(response.requestId);
        if (pending) {
          pending.resolve({
            approved: response.approved,
            remember: response.rememberChoice,
          });
          pendingPermissions.delete(response.requestId);
        }
      }
    );
  }

  private async executeRequest(request: ClaudeCodeRequest): Promise<void> {
    const { id, chatId, userId, projectName, prompt, sessionId } = request;

    // Verify authorization
    if (!projectManager.isAuthorizedUser(userId)) {
      bus.publish("claude-code:response", {
        requestId: id,
        chatId,
        text: "You are not authorized to use Claude Code features.",
      });
      return;
    }

    // Get project path
    const projectPath = projectManager.getProject(projectName);
    if (!projectPath) {
      const projects = projectManager.listProjects();
      const projectList =
        projects.length > 0
          ? projects.map((p) => `- ${p.name}`).join("\n")
          : "No projects configured.";

      bus.publish("claude-code:response", {
        requestId: id,
        chatId,
        text: `Project "${projectName}" not found.\n\nAvailable projects:\n${projectList}`,
      });
      return;
    }

    try {
      console.log(`[ClaudeCode] Executing in ${projectName}: "${prompt.slice(0, 50)}..."`);

      let currentSessionId: string | undefined = sessionId;
      let resultText = "";

      // Query Claude Agent SDK
      const response = query({
        prompt,
        options: {
          cwd: projectPath,
          resume: sessionId,
          // Use 'tools' to specify available tools, NOT 'allowedTools' (which auto-approves)
          tools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "LSP"],
          permissionMode: "default",
          canUseTool: async (toolName: string, input: Record<string, unknown>, _options) => {
            return this.handlePermission(
              id,
              chatId,
              projectName,
              toolName,
              input
            );
          },
        },
      });

      for await (const message of response) {
        // Capture session ID
        if (message.type === "system" && (message as any).subtype === "init") {
          currentSessionId = (message as any).session_id;
          if (currentSessionId) {
            activeSessions.set(`${chatId}:${projectName}`, currentSessionId);
          }
        }

        // Collect text output
        if (message.type === "assistant" && (message as any).message?.content) {
          for (const block of (message as any).message.content) {
            if ("text" in block && block.text) {
              resultText += block.text + "\n";
            }
          }
        }

        // Handle result
        if (message.type === "result") {
          const finalText = resultText.trim() || (message as any).result || "Done.";
          this.sendChunkedResponse(id, chatId, finalText, currentSessionId);
        }
      }
    } catch (error) {
      console.error("[ClaudeCode] Error:", error);
      bus.publish("claude-code:response", {
        requestId: id,
        chatId,
        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private async handlePermission(
    requestId: string,
    chatId: string,
    projectName: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<
    | { behavior: "allow"; updatedInput: Record<string, unknown> }
    | { behavior: "deny"; message: string }
  > {
    // Check permission memory first
    const cached = permissionManager.checkPermission(projectName, toolName, input);

    if (cached === "allowed") {
      console.log(`[ClaudeCode] Permission cached: allow ${toolName}`);
      return { behavior: "allow" as const, updatedInput: input };
    }

    if (cached === "denied") {
      console.log(`[ClaudeCode] Permission cached: deny ${toolName}`);
      return { behavior: "deny" as const, message: "This action was previously denied." };
    }

    // Need to ask user
    const permissionId = `perm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const description = this.formatPermissionDescription(toolName, input);

    console.log(`[ClaudeCode] Asking permission for: ${description}`);

    // Publish permission request to Telegram
    bus.publish("claude-code:permission", {
      requestId: permissionId,
      chatId,
      projectName,
      toolName,
      toolInput: input,
      description,
    } as ClaudeCodePermissionRequest);

    // Wait for user response
    const result = await new Promise<{ approved: boolean; remember: boolean }>(
      (resolve) => {
        pendingPermissions.set(permissionId, { resolve });

        // Timeout after 5 minutes
        setTimeout(() => {
          if (pendingPermissions.has(permissionId)) {
            pendingPermissions.delete(permissionId);
            resolve({ approved: false, remember: false });
          }
        }, 5 * 60 * 1000);
      }
    );

    // Remember the decision if requested
    if (result.remember) {
      permissionManager.remember(projectName, toolName, input, result.approved);
    }

    if (result.approved) {
      return { behavior: "allow" as const, updatedInput: input };
    } else {
      return { behavior: "deny" as const, message: "User denied permission." };
    }
  }

  private formatPermissionDescription(
    toolName: string,
    input: Record<string, unknown>
  ): string {
    switch (toolName) {
      case "Edit":
        return `Edit file: ${input.file_path}`;
      case "Write":
        return `Create/overwrite file: ${input.file_path}`;
      case "Bash":
        return `Run command: ${String(input.command).slice(0, 100)}`;
      case "Read":
        return `Read file: ${input.file_path}`;
      default:
        return `Use tool ${toolName}`;
    }
  }

  private sendChunkedResponse(
    requestId: string,
    chatId: string,
    text: string,
    sessionId?: string
  ): void {
    const MAX_CHUNK_SIZE = 4000;

    if (text.length <= MAX_CHUNK_SIZE) {
      bus.publish("claude-code:response", {
        requestId,
        chatId,
        text,
        sessionId,
      });
      return;
    }

    // Split into chunks
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_CHUNK_SIZE) {
        chunks.push(remaining);
        break;
      }

      let splitIndex = remaining.lastIndexOf("\n", MAX_CHUNK_SIZE);
      if (splitIndex === -1 || splitIndex < MAX_CHUNK_SIZE / 2) {
        splitIndex = MAX_CHUNK_SIZE;
      }

      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex + 1);
    }

    // Send chunks with part indicators
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const partIndicator =
        chunks.length > 1 ? `[Part ${i + 1}/${chunks.length}]\n\n` : "";

      bus.publish("claude-code:response", {
        requestId,
        chatId,
        text: partIndicator + chunks[i],
        sessionId: isLast ? sessionId : undefined,
        isPartial: !isLast,
      });
    }
  }

  getActiveSession(chatId: string, projectName: string): string | undefined {
    return activeSessions.get(`${chatId}:${projectName}`);
  }

  clearSession(chatId: string, projectName: string): void {
    activeSessions.delete(`${chatId}:${projectName}`);
  }
}

export const claudeCodeExecutor = new ClaudeCodeExecutor();
