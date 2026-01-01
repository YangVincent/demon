export interface IncomingMessage {
  id: string;
  source: "telegram" | "webhook" | "cron";
  userId: string;
  chatId: string;
  text: string;
  timestamp: Date;
}

export interface OutgoingResponse {
  messageId: string; // ID of the message this responds to
  chatId: string;
  text: string;
  source: "telegram" | "webhook";
}

export type BusEvents = {
  "message:incoming": IncomingMessage;
  "message:response": OutgoingResponse;
};
