# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev    # Start with hot reload (development)
npm start      # Start the bot
```

## Architecture

Digital butler with pubsub architecture:

```
Input Sources → Event Bus → Claude Worker → Responses
```

- **Event Bus** (`src/bus/`): In-memory EventEmitter pubsub. Abstracted for future Redis/BullMQ swap.
- **Inputs** (`src/inputs/`): Sources that publish `message:incoming` events. Currently Telegram.
- **Worker** (`src/worker/`): Subscribes to incoming messages, calls Claude API with tools, publishes responses.
- **Memory** (`src/memory/`): Per-chat conversation history. Auto-truncates to 20 messages, expires after 1 hour.

### Todoist Integration

The worker has tools for Todoist (`src/worker/tools.ts`):
- `list_tasks`: Supports `filter` param (e.g., "today", "today & #Inbox")
- `create_task`: Natural language due dates
- `complete_task`: By ID or content search
- `update_task`: Change content, due date, priority

### Telegram Commands

- `/clear`: Reset conversation memory for current chat

### Adding New Input Sources

Create a new file in `src/inputs/` that:
1. Publishes `IncomingMessage` to `bus.publish("message:incoming", ...)`
2. Subscribes to `message:response` to send replies back

### Event Types

- `message:incoming`: User message from any source
- `message:response`: Claude's response to route back

## Environment Variables

Copy `.env.example` to `.env`:
- `TELEGRAM_BOT_TOKEN`: Get from @BotFather on Telegram
- `ANTHROPIC_API_KEY`: Get from console.anthropic.com
- `TODOIST_API_TOKEN`: Get from Todoist Settings → Integrations → Developer
