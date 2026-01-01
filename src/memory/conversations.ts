import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

interface ConversationEntry {
  messages: MessageParam[];
  lastUpdated: Date;
}

// Max messages to keep per conversation (user + assistant pairs)
const MAX_MESSAGES = 20;

// Max age before conversation is cleared (1 hour)
const MAX_AGE_MS = 60 * 60 * 1000;

class ConversationStore {
  private conversations = new Map<string, ConversationEntry>();

  /**
   * Get conversation history for a chat
   */
  getHistory(chatId: string): MessageParam[] {
    const entry = this.conversations.get(chatId);

    if (!entry) {
      return [];
    }

    // Check if conversation is stale
    if (Date.now() - entry.lastUpdated.getTime() > MAX_AGE_MS) {
      this.conversations.delete(chatId);
      return [];
    }

    return entry.messages;
  }

  /**
   * Add a user message to the conversation
   */
  addUserMessage(chatId: string, content: string): void {
    this.ensureConversation(chatId);
    const entry = this.conversations.get(chatId)!;

    entry.messages.push({
      role: "user",
      content,
    });
    entry.lastUpdated = new Date();

    this.truncateIfNeeded(chatId);
  }

  /**
   * Add an assistant message to the conversation
   */
  addAssistantMessage(chatId: string, content: string): void {
    this.ensureConversation(chatId);
    const entry = this.conversations.get(chatId)!;

    entry.messages.push({
      role: "assistant",
      content,
    });
    entry.lastUpdated = new Date();

    this.truncateIfNeeded(chatId);
  }

  /**
   * Add full message history from a tool-use conversation
   */
  setMessages(chatId: string, messages: MessageParam[]): void {
    this.ensureConversation(chatId);
    const entry = this.conversations.get(chatId)!;
    entry.messages = messages;
    entry.lastUpdated = new Date();

    this.truncateIfNeeded(chatId);
  }

  /**
   * Clear conversation history for a chat
   */
  clear(chatId: string): void {
    this.conversations.delete(chatId);
  }

  /**
   * Clear all conversations
   */
  clearAll(): void {
    this.conversations.clear();
  }

  private ensureConversation(chatId: string): void {
    if (!this.conversations.has(chatId)) {
      this.conversations.set(chatId, {
        messages: [],
        lastUpdated: new Date(),
      });
    }
  }

  private truncateIfNeeded(chatId: string): void {
    const entry = this.conversations.get(chatId);
    if (!entry) return;

    // Keep only the last MAX_MESSAGES messages
    if (entry.messages.length > MAX_MESSAGES) {
      // Remove oldest messages, but keep pairs intact
      const toRemove = entry.messages.length - MAX_MESSAGES;
      entry.messages = entry.messages.slice(toRemove);

      // Ensure we start with a user message
      while (entry.messages.length > 0 && entry.messages[0].role !== "user") {
        entry.messages.shift();
      }
    }
  }
}

// Singleton instance
export const conversationStore = new ConversationStore();
