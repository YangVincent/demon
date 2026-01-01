import "dotenv/config";
import { startTelegramBot } from "./inputs/telegram.js";
import { startAgent } from "./worker/agent.js";

async function main() {
  console.log("Starting Demon - Digital Butler");
  console.log("================================\n");

  // Start the Claude agent worker (connects to MCP servers)
  await startAgent();

  // Start input sources
  startTelegramBot();

  console.log("\nAll services started. Press Ctrl+C to stop.\n");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
