import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { bus } from "../bus/eventBus.js";
import type { IncomingMessage } from "../bus/types.js";
import { config } from "../config.js";
import { tools, executeTool } from "./tools.js";
import { conversationStore } from "../memory/conversations.js";

const SYSTEM_PROMPT = `You are a helpful digital butler assistant. You help the user with various tasks and questions.

You have access to the user's Todoist task manager. You can:
- List their tasks (optionally filtered by project or due date)
- Create new tasks with natural language due dates
- Mark tasks as complete
- Update existing tasks

When the user asks about tasks, todos, or reminders, use the Todoist tools to help them.
Be concise but friendly. When listing tasks, format them nicely.

You have memory of previous messages in this conversation. You can reference what was discussed earlier.`;

export function startAgent(): void {
  const client = new Anthropic({
    apiKey: config.anthropic.apiKey(),
  });

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
      tools,
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
      const responseText = textBlock?.text || "I couldn't generate a response.";

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
