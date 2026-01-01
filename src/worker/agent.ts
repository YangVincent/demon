import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { bus } from "../bus/eventBus.js";
import type { IncomingMessage } from "../bus/types.js";
import { config } from "../config.js";
import { getAllTools, executeTool } from "./tools.js";
import { conversationStore } from "../memory/conversations.js";
import { mcpManager, type MCPServerConfig } from "../mcp/client.js";

const SYSTEM_PROMPT = `You are a helpful digital butler assistant. You help the user with various tasks and questions.

You have access to:

**Todoist** - Task management:
- List tasks (with filters like "today", "overdue")
- Create new tasks with natural language due dates
- Mark tasks as complete
- Update existing tasks

**Notion** - Notes and databases:
- Search for pages and databases
- Query database entries
- Create new pages or database entries
- Read page content
- Append content to pages

**Web Search** - Search the internet:
- Look up current information, news, or facts
- Find answers to questions that need up-to-date information

When the user asks about tasks/todos, use Todoist. When they ask about notes, documents, or databases, use Notion. When they need current information from the web, use web search.
Be concise but friendly. Format results nicely.

You have memory of previous messages in this conversation.`;

export async function startAgent(): Promise<void> {
  const client = new Anthropic({
    apiKey: config.anthropic.apiKey(),
  });

  // Connect to MCP servers
  const mcpServers: MCPServerConfig[] = [
    {
      name: "todoist",
      command: "npx",
      args: ["-y", "todoist-mcp"],
      env: { API_KEY: config.todoist.apiToken() },
    },
    {
      name: "notion",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      env: { NOTION_TOKEN: config.notion.apiToken() },
    },
  ];

  // Add Tavily if API key is configured
  const tavilyKey = config.tavily.apiKey();
  if (tavilyKey) {
    mcpServers.push({
      name: "tavily",
      command: "npx",
      args: ["-y", "tavily-mcp"],
      env: { TAVILY_API_KEY: tavilyKey },
    });
  }

  for (const server of mcpServers) {
    try {
      await mcpManager.connectServer(server);
    } catch (error) {
      console.warn(`[Agent] Could not connect to ${server.name} MCP server:`, error);
    }
  }

  bus.subscribe("message:incoming", async (message: IncomingMessage) => {
    console.log(`[Agent] Processing message: "${message.text}"`);

    try {
      // Check for clear memory command
      if (message.text.toLowerCase().trim() === "/clear") {
        conversationStore.clear(message.chatId);
        bus.publish("message:response", {
          messageId: message.id,
          chatId: message.chatId,
          text: "Conversation history cleared.",
          source: message.source === "telegram" ? "telegram" : "webhook",
        });
        return;
      }

      const responseText = await processWithTools(client, message.chatId, message.text);
      console.log(`[Agent] Response: "${responseText.slice(0, 100)}..."`);

      bus.publish("message:response", {
        messageId: message.id,
        chatId: message.chatId,
        text: responseText,
        source: message.source === "telegram" ? "telegram" : "webhook",
      });
    } catch (error) {
      console.error("[Agent] Error processing message:", error);

      bus.publish("message:response", {
        messageId: message.id,
        chatId: message.chatId,
        text: "Sorry, I encountered an error processing your message.",
        source: message.source === "telegram" ? "telegram" : "webhook",
      });
    }
  });

  console.log("[Agent] Worker started, listening for messages");
}

async function processWithTools(
  client: Anthropic,
  chatId: string,
  userMessage: string
): Promise<string> {
  // Get existing conversation history
  const history = conversationStore.getHistory(chatId);

  // Build messages array with history + new message
  const messages: MessageParam[] = [
    ...history,
    {
      role: "user",
      content: userMessage,
    },
  ];

  // Tool use loop - keep going until we get a final text response
  while (true) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: getAllTools(),
      messages,
    });

    // Check if Claude wants to use tools
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      // No tool use - extract and return text response
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );

      let responseText: string;
      if (textBlock?.text) {
        responseText = textBlock.text;
      } else {
        // Build debug info when no text response
        const lastToolResults = messages[messages.length - 1];
        let debugInfo = `No text response from Claude.\n`;
        debugInfo += `Stop reason: ${response.stop_reason}\n`;
        debugInfo += `Content blocks: ${response.content.map(b => b.type).join(", ") || "none"}\n`;

        if (lastToolResults?.role === "user" && Array.isArray(lastToolResults.content)) {
          debugInfo += `\nLast tool results:\n`;
          for (const result of lastToolResults.content) {
            if (result.type === "tool_result") {
              const preview = String(result.content).slice(0, 200);
              debugInfo += `- ${result.is_error ? "ERROR: " : ""}${preview}${String(result.content).length > 200 ? "..." : ""}\n`;
            }
          }
        }

        responseText = debugInfo;
        console.error("[Agent] No text response:", debugInfo);
      }

      // Save the conversation (just the user message and final assistant response)
      conversationStore.addUserMessage(chatId, userMessage);
      conversationStore.addAssistantMessage(chatId, responseText);

      return responseText;
    }

    // Execute tools and add results to messages
    console.log(`[Agent] Using ${toolUseBlocks.length} tool(s)`);

    // Add assistant's response (with tool_use blocks) to messages
    messages.push({
      role: "assistant",
      content: response.content,
    });

    // Execute each tool and collect results
    const toolResults: ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      console.log(`[Agent] Executing tool: ${toolUse.name}`);
      const result = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>);
      result.tool_use_id = toolUse.id;
      toolResults.push(result);
    }

    // Add tool results to messages
    messages.push({
      role: "user",
      content: toolResults,
    });

    // Continue loop to get Claude's response after tool use
  }
}
