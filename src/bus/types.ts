import type {
  ClaudeCodeRequest,
  ClaudeCodePermissionRequest,
  ClaudeCodePermissionResponse,
  ClaudeCodeResponse,
} from "../claude-code/types.js";

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
  "claude-code:request": ClaudeCodeRequest;
  "claude-code:permission": ClaudeCodePermissionRequest;
  "claude-code:permission-response": ClaudeCodePermissionResponse;
  "claude-code:response": ClaudeCodeResponse;
};
