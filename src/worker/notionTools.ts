import { Client } from "@notionhq/client";
import type { Tool, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { config } from "../config.js";

let notionClient: Client | null = null;

function getNotionClient(): Client {
  if (!notionClient) {
    notionClient = new Client({ auth: config.notion.apiToken() });
  }
  return notionClient;
}

// Tool definitions for Claude
export const notionTools: Tool[] = [
  {
    name: "notion_search",
    description:
      "Search Notion for pages and databases by title. Returns matching pages and databases the integration has access to.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query to find pages or databases by title",
        },
        filter: {
          type: "string",
          enum: ["page", "database"],
          description: "Optional: filter to only pages or only databases",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "notion_query_database",
    description:
      "Query a Notion database to get entries. Can filter and sort results. Use notion_search first to find the database ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        database_id: {
          type: "string",
          description: "The ID of the database to query",
        },
        filter_property: {
          type: "string",
          description: "Optional: property name to filter by",
        },
        filter_value: {
          type: "string",
          description: "Optional: value to filter for (used with filter_property)",
        },
      },
      required: ["database_id"],
    },
  },
  {
    name: "notion_create_page",
    description:
      "Create a new page in Notion. Can create a standalone page or add an entry to a database.",
    input_schema: {
      type: "object" as const,
      properties: {
        parent_id: {
          type: "string",
          description: "The ID of the parent page or database",
        },
        parent_type: {
          type: "string",
          enum: ["page", "database"],
          description: "Whether the parent is a page or database",
        },
        title: {
          type: "string",
          description: "The title of the new page",
        },
        content: {
          type: "string",
          description: "Optional: text content to add to the page body",
        },
        properties: {
          type: "object",
          description: "Optional: additional properties for database entries (e.g., {\"Status\": \"In Progress\"})",
        },
      },
      required: ["parent_id", "parent_type", "title"],
    },
  },
  {
    name: "notion_read_page",
    description:
      "Read the content of a Notion page. Returns the page properties and text content.",
    input_schema: {
      type: "object" as const,
      properties: {
        page_id: {
          type: "string",
          description: "The ID of the page to read",
        },
      },
      required: ["page_id"],
    },
  },
  {
    name: "notion_append_blocks",
    description:
      "Append content blocks to an existing Notion page. Use this to add text, headings, bullets, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        page_id: {
          type: "string",
          description: "The ID of the page to append to",
        },
        content: {
          type: "string",
          description: "Text content to append. Use newlines to create multiple paragraphs.",
        },
        block_type: {
          type: "string",
          enum: ["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item"],
          description: "Type of block to create. Defaults to paragraph.",
        },
      },
      required: ["page_id", "content"],
    },
  },
];

// Tool execution
export async function executeNotionTool(
  name: string,
  input: Record<string, unknown>
): Promise<ToolResultBlockParam> {
  try {
    const result = await executeNotionToolInternal(name, input);
    return {
      type: "tool_result",
      tool_use_id: "", // Will be set by caller
      content: JSON.stringify(result, null, 2),
    };
  } catch (error) {
    return {
      type: "tool_result",
      tool_use_id: "", // Will be set by caller
      content: `Error: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

async function executeNotionToolInternal(
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const client = getNotionClient();

  switch (name) {
    case "notion_search": {
      const searchParams: any = {
        query: String(input.query),
        page_size: 10,
      };

      if (input.filter === "page") {
        searchParams.filter = { property: "object", value: "page" };
      } else if (input.filter === "database") {
        searchParams.filter = { property: "object", value: "database" };
      }

      const response = await client.search(searchParams);

      return response.results.map((result: any) => ({
        id: result.id,
        type: result.object,
        title: extractTitle(result),
        url: result.url,
      }));
    }

    case "notion_query_database": {
      const databaseId = String(input.database_id);

      const queryParams: any = {
        database_id: databaseId,
        page_size: 20,
      };

      if (input.filter_property && input.filter_value) {
        queryParams.filter = {
          property: String(input.filter_property),
          rich_text: { contains: String(input.filter_value) },
        };
      }

      const response = await (client.databases as any).query(queryParams);

      return response.results.map((page: any) => ({
        id: page.id,
        title: extractTitle(page),
        properties: extractProperties(page.properties),
        url: page.url,
      }));
    }

    case "notion_create_page": {
      const parentId = String(input.parent_id);
      const parentType = String(input.parent_type);
      const title = String(input.title);

      let parent: any;
      let properties: any;

      if (parentType === "database") {
        parent = { database_id: parentId };
        properties = {
          title: { title: [{ text: { content: title } }] },
          ...(input.properties ? buildDatabaseProperties(input.properties as Record<string, unknown>) : {}),
        };
      } else {
        parent = { page_id: parentId };
        properties = {
          title: { title: [{ text: { content: title } }] },
        };
      }

      const children: any[] = [];
      if (input.content) {
        const lines = String(input.content).split("\n");
        for (const line of lines) {
          if (line.trim()) {
            children.push({
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [{ type: "text", text: { content: line } }],
              },
            });
          }
        }
      }

      const response = await client.pages.create({
        parent,
        properties,
        children: children.length > 0 ? children : undefined,
      });

      return {
        id: response.id,
        url: (response as any).url,
        title,
      };
    }

    case "notion_read_page": {
      const pageId = String(input.page_id);

      // Get page properties
      const page = await client.pages.retrieve({ page_id: pageId }) as any;

      // Get page content (blocks)
      const blocks = await client.blocks.children.list({
        block_id: pageId,
        page_size: 50,
      });

      const content = blocks.results.map((block: any) => {
        return extractBlockText(block);
      }).filter(Boolean);

      return {
        id: page.id,
        title: extractTitle(page),
        properties: extractProperties(page.properties),
        content: content.join("\n"),
        url: page.url,
      };
    }

    case "notion_append_blocks": {
      const pageId = String(input.page_id);
      const content = String(input.content);
      const blockType = (input.block_type as string) || "paragraph";

      const lines = content.split("\n").filter((line) => line.trim());
      const blocks = lines.map((line) => ({
        object: "block" as const,
        type: blockType,
        [blockType]: {
          rich_text: [{ type: "text" as const, text: { content: line } }],
        },
      }));

      await client.blocks.children.append({
        block_id: pageId,
        children: blocks as any,
      });

      return { success: true, blocks_added: blocks.length };
    }

    default:
      throw new Error(`Unknown Notion tool: ${name}`);
  }
}

// Helper functions
function extractTitle(item: any): string {
  if (item.properties?.title?.title?.[0]?.plain_text) {
    return item.properties.title.title[0].plain_text;
  }
  if (item.properties?.Name?.title?.[0]?.plain_text) {
    return item.properties.Name.title[0].plain_text;
  }
  if (item.title?.[0]?.plain_text) {
    return item.title[0].plain_text;
  }
  return "Untitled";
}

function extractProperties(properties: any): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties || {})) {
    const prop = value as any;

    switch (prop.type) {
      case "title":
      case "rich_text":
        result[key] = prop[prop.type]?.[0]?.plain_text || "";
        break;
      case "number":
        result[key] = prop.number;
        break;
      case "select":
        result[key] = prop.select?.name || null;
        break;
      case "multi_select":
        result[key] = prop.multi_select?.map((s: any) => s.name) || [];
        break;
      case "date":
        result[key] = prop.date?.start || null;
        break;
      case "checkbox":
        result[key] = prop.checkbox;
        break;
      case "url":
        result[key] = prop.url;
        break;
      case "email":
        result[key] = prop.email;
        break;
      case "status":
        result[key] = prop.status?.name || null;
        break;
      default:
        // Skip complex types
        break;
    }
  }

  return result;
}

function extractBlockText(block: any): string {
  const type = block.type;
  const content = block[type];

  if (content?.rich_text) {
    return content.rich_text.map((t: any) => t.plain_text).join("");
  }

  return "";
}

function buildDatabaseProperties(props: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (typeof value === "string") {
      // Assume it's a text property or select
      result[key] = { rich_text: [{ text: { content: value } }] };
    } else if (typeof value === "number") {
      result[key] = { number: value };
    } else if (typeof value === "boolean") {
      result[key] = { checkbox: value };
    }
  }

  return result;
}
