import type { Tool, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { mcpManager } from "../mcp/client.js";

// Get all tools from MCP servers
export function getAllTools(): Tool[] {
  return mcpManager.getAllTools();
}

// Tool execution - all tools come from MCP
export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<ToolResultBlockParam> {
  try {
    if (mcpManager.hasTool(name)) {
      const result = await mcpManager.executeTool(name, input);
      return {
        type: "tool_result",
        tool_use_id: "",
        content: result,
      };
    }

    return {
      type: "tool_result",
      tool_use_id: "",
      content: `Error: Unknown tool: ${name}`,
      is_error: true,
    };
  } catch (error) {
    return {
      type: "tool_result",
      tool_use_id: "",
      content: `Error: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}
