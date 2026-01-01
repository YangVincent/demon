import { Bot, InlineKeyboard } from "grammy";
import { bus } from "../bus/eventBus.js";
import type { IncomingMessage, OutgoingResponse } from "../bus/types.js";
import type {
  ClaudeCodePermissionRequest,
  ClaudeCodeResponse,
} from "../claude-code/types.js";
import { config } from "../config.js";
import { parseClaudeCodeCommand } from "../claude-code/parser.js";
import { projectManager } from "../claude-code/projects.js";
import { permissionManager } from "../claude-code/permissions.js";
import { claudeCodeExecutor } from "../claude-code/executor.js";

export function startTelegramBot(): Bot {
  const bot = new Bot(config.telegram.token());

  // Handle incoming messages
  bot.on("message:text", (ctx) => {
    const userId = String(ctx.from.id);
    const chatId = String(ctx.chat.id);
    const text = ctx.message.text;

    // Try to parse as Claude Code command
    const codeCommand = parseClaudeCodeCommand(text);
    console.log(`[Telegram] Parse result for "${text.slice(0, 50)}...":`, codeCommand);

    if (codeCommand) {
      handleClaudeCodeCommand(codeCommand, userId, chatId, ctx);
      return;
    }

    // Regular message handling
    const message: IncomingMessage = {
      id: `tg-${ctx.message.message_id}`,
      source: "telegram",
      userId,
      chatId,
      text,
      timestamp: new Date(ctx.message.date * 1000),
    };

    console.log(`[Telegram] Received: "${message.text}" from ${message.userId}`);
    bus.publish("message:incoming", message);
  });

  // Handle callback queries (for permission buttons)
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = String(ctx.chat?.id);

    // Parse callback data: "perm:requestId:action:remember"
    if (data.startsWith("perm:")) {
      const [, requestId, action, remember] = data.split(":");

      bus.publish("claude-code:permission-response", {
        requestId,
        chatId,
        approved: action === "allow",
        rememberChoice: remember === "yes",
      });

      // Update message to show decision
      const originalText = ctx.callbackQuery.message?.text || "";
      await ctx.editMessageText(
        `${originalText}\n\n✓ ${action === "allow" ? "Allowed" : "Denied"}${remember === "yes" ? " (remembered)" : ""}`
      );

      await ctx.answerCallbackQuery();
    }
  });

  // Subscribe to regular responses
  bus.subscribe("message:response", async (response: OutgoingResponse) => {
    if (response.source !== "telegram") return;
    await sendTelegramMessage(bot, response.chatId, response.text);
  });

  // Subscribe to Claude Code responses
  bus.subscribe("claude-code:response", async (response: ClaudeCodeResponse) => {
    await sendTelegramMessage(bot, response.chatId, response.text);
  });

  // Subscribe to permission requests
  bus.subscribe(
    "claude-code:permission",
    async (request: ClaudeCodePermissionRequest) => {
      const keyboard = new InlineKeyboard()
        .text("Allow", `perm:${request.requestId}:allow:no`)
        .text("Allow & Remember", `perm:${request.requestId}:allow:yes`)
        .row()
        .text("Deny", `perm:${request.requestId}:deny:no`)
        .text("Deny & Remember", `perm:${request.requestId}:deny:yes`);

      await bot.api.sendMessage(
        request.chatId,
        `⚠️ *Permission Required*\n\nProject: \`${request.projectName}\`\n${request.description}`,
        {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        }
      );
    }
  );

  // Start the bot
  bot.start({
    onStart: (botInfo) => {
      console.log(`[Telegram] Bot @${botInfo.username} is running`);
    },
  });

  return bot;
}

async function handleClaudeCodeCommand(
  command: ReturnType<typeof parseClaudeCodeCommand>,
  userId: string,
  chatId: string,
  ctx: any
): Promise<void> {
  if (!command) return;

  switch (command.type) {
    case "list-projects": {
      const projects = projectManager.listProjects();
      const list =
        projects.length > 0
          ? projects.map((p) => `• \`${p.name}\`: ${p.path}`).join("\n")
          : "No projects configured.\n\nEdit `data/claude-code-config.json` to add projects.";
      await ctx.reply(`📁 *Available Projects*\n\n${list}`, {
        parse_mode: "Markdown",
      });
      break;
    }

    case "clear-session":
      claudeCodeExecutor.clearSession(chatId, command.projectName);
      await ctx.reply(`Session cleared for project: ${command.projectName}`);
      break;

    case "clear-permissions":
      if (!projectManager.isAuthorizedUser(userId)) {
        await ctx.reply("You are not authorized for this action.");
        return;
      }
      permissionManager.clearProject(command.projectName);
      await ctx.reply(
        `Permission memory cleared for project: ${command.projectName}`
      );
      break;

    case "claude-code": {
      // Show typing indicator
      await ctx.replyWithChatAction("typing");

      // Check if this continues an existing session
      const existingSession = claudeCodeExecutor.getActiveSession(
        chatId,
        command.projectName
      );

      bus.publish("claude-code:request", {
        id: `cc-${Date.now()}`,
        chatId,
        userId,
        projectName: command.projectName,
        prompt: command.prompt,
        sessionId: existingSession,
      });
      break;
    }
  }
}

async function sendTelegramMessage(
  bot: Bot,
  chatId: string,
  text: string
): Promise<void> {
  const MAX_LENGTH = 4096;

  try {
    if (text.length <= MAX_LENGTH) {
      await bot.api.sendMessage(chatId, text);
    } else {
      // Split long messages
      const parts = splitMessage(text, MAX_LENGTH);
      for (const part of parts) {
        await bot.api.sendMessage(chatId, part);
      }
    }
    console.log(`[Telegram] Sent response to ${chatId}`);
  } catch (error) {
    console.error("[Telegram] Failed to send message:", error);
  }
}

function splitMessage(text: string, maxLength: number): string[] {
  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      parts.push(remaining);
      break;
    }

    // Try to split at newline
    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      // Try space
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    parts.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex + 1);
  }

  return parts;
}
