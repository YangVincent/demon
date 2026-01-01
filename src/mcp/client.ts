import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface MCPToolRegistry {
  client: Client;
  tools: Tool[];
  toolNames: Set<string>;
  name: string;
}

export class MCPClientManager {
  private servers: Map<string, MCPToolRegistry> = new Map();

  async connectServer(config: MCPServerConfig): Promise<void> {
    try {
      console.log(`[MCP] Connecting to server: ${config.name}`);

      // Create transport (uses stdio for local processes)
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: { ...process.env, ...config.env } as Record<string, string>,
      });

      // Create MCP client
      const client = new Client(
        {
          name: "demon-agent",
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );

      // Connect the client
      await client.connect(transport);

      // List available tools from this MCP server
      const toolList = await client.listTools();
      console.log(`[MCP] Server "${config.name}" provides ${toolList.tools.length} tool(s)`);

      // Convert MCP tools to Claude format
      const claudeTools: Tool[] = toolList.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        input_schema: tool.inputSchema as Tool["input_schema"],
      }));

      const toolNames = new Set(toolList.tools.map((t) => t.name));

      // Store the client and its tools
      this.servers.set(config.name, {
        client,
        tools: claudeTools,
        toolNames,
        name: config.name,
      });

      console.log(`[MCP] Connected to ${config.name}: ${[...toolNames].join(", ")}`);
    } catch (error) {
      console.error(`[MCP] Failed to connect to ${config.name}:`, error);
      throw error;
    }
  }

  // Get all tools from all connected servers
  getAllTools(): Tool[] {
    const allTools: Tool[] = [];
    for (const registry of this.servers.values()) {
      allTools.push(...registry.tools);
    }
    return allTools;
  }

  // Check if a tool is provided by any MCP server
  hasTool(toolName: string): boolean {
    for (const registry of this.servers.values()) {
      if (registry.toolNames.has(toolName)) {
        return true;
      }
    }
    return false;
  }

  // Execute a tool from any connected server
  async executeTool(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<string> {
    // Search for the tool in all connected servers
    for (const [, registry] of this.servers) {
      if (registry.toolNames.has(toolName)) {
        console.log(`[MCP] Executing tool "${toolName}" on server "${registry.name}"`);

        const result = await registry.client.callTool({
          name: toolName,
          arguments: input,
        });

        // Extract text content from result
        if (result.content && Array.isArray(result.content)) {
          const textParts = result.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text);

          if (textParts.length > 0) {
            return textParts.join("\n");
          }
        }

        return JSON.stringify(result.content);
      }
    }

    throw new Error(`MCP tool not found: ${toolName}`);
  }

  // Disconnect all servers
  async disconnectAll(): Promise<void> {
    for (const registry of this.servers.values()) {
      try {
        await registry.client.close();
        console.log(`[MCP] Disconnected from ${registry.name}`);
      } catch (error) {
        console.error(`[MCP] Error closing ${registry.name}:`, error);
      }
    }
    this.servers.clear();
  }
}

// Export singleton instance
export const mcpManager = new MCPClientManager();
