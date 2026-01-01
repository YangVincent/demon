import { Bot } from "grammy";
import { bus } from "../bus/eventBus.js";
import type { IncomingMessage, OutgoingResponse } from "../bus/types.js";
import { config } from "../config.js";

export function startTelegramBot(): Bot {
  const bot = new Bot(config.telegram.token());

  // Handle incoming messages
  bot.on("message:text", (ctx) => {
    const message: IncomingMessage = {
      id: `tg-${ctx.message.message_id}`,
      source: "telegram",
      userId: String(ctx.from.id),
      chatId: String(ctx.chat.id),
      text: ctx.message.text,
      timestamp: new Date(ctx.message.date * 1000),
    };

    console.log(`[Telegram] Received: "${message.text}" from ${message.userId}`);
    bus.publish("message:incoming", message);
  });

  // Subscribe to responses and send them
  bus.subscribe("message:response", async (response: OutgoingResponse) => {
    if (response.source !== "telegram") return;

    try {
      await bot.api.sendMessage(response.chatId, response.text);
      console.log(`[Telegram] Sent response to ${response.chatId}`);
    } catch (error) {
      console.error("[Telegram] Failed to send message:", error);
    }
  });

  // Start the bot
  bot.start({
    onStart: (botInfo) => {
      console.log(`[Telegram] Bot @${botInfo.username} is running`);
    },
  });

  return bot;
}
