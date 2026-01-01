import { TodoistApi } from "@doist/todoist-api-typescript";
import type { Tool, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { config } from "../config.js";
import { notionTools, executeNotionTool } from "./notionTools.js";

// Types for Todoist responses
interface TodoistTask {
  id: string;
  content: string;
  projectId: string;
  priority: number;
  due?: { string: string } | null;
}

interface TodoistProject {
  id: string;
  name: string;
}

interface TodoistResponse<T> {
  results: T[];
}

let todoistClient: TodoistApi | null = null;

function getTodoistClient(): TodoistApi {
  if (!todoistClient) {
    todoistClient = new TodoistApi(config.todoist.apiToken());
  }
  return todoistClient;
}

// Tool definitions for Claude
export const tools: Tool[] = [
  {
    name: "list_tasks",
    description:
      "List tasks from Todoist. Can filter by project name, due date, or use Todoist filter syntax. Returns task ID, content, due date, and priority.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_name: {
          type: "string",
          description: "Optional project name to filter tasks.",
        },
        filter: {
          type: "string",
          description: "Todoist filter query like 'today', 'overdue', 'today & #Inbox', 'due before: tomorrow'. Use this for date-based filtering.",
        },
      },
      required: [],
    },
  },
  {
    name: "create_task",
    description:
      "Create a new task in Todoist. Supports natural language due dates like 'tomorrow', 'next monday', 'in 3 days'.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "The task content/title",
        },
        due_string: {
          type: "string",
          description:
            "Natural language due date like 'tomorrow', 'next monday', 'jan 15', 'in 3 days'. Optional.",
        },
        priority: {
          type: "number",
          description: "Priority from 1 (normal) to 4 (urgent). Optional, defaults to 1.",
        },
        project_name: {
          type: "string",
          description: "Project name to add the task to. Optional, defaults to Inbox.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "complete_task",
    description: "Mark a task as complete. Can find task by ID or by searching for matching content.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: {
          type: "string",
          description: "The task ID to complete. Use this if you know the exact ID.",
        },
        search_content: {
          type: "string",
          description:
            "Search for a task by content. Will complete the first matching task. Use if you don't have the ID.",
        },
      },
      required: [],
    },
  },
  {
    name: "update_task",
    description: "Update an existing task's content, due date, or priority.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: {
          type: "string",
          description: "The task ID to update. Use list_tasks first to find the ID.",
        },
        content: {
          type: "string",
          description: "New task content. Optional.",
        },
        due_string: {
          type: "string",
          description: "New due date in natural language. Optional.",
        },
        priority: {
          type: "number",
          description: "New priority from 1-4. Optional.",
        },
      },
      required: ["task_id"],
    },
  },
  // Include Notion tools
  ...notionTools,
];

// Tool execution
export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<ToolResultBlockParam> {
  // Route Notion tools to their handler
  if (name.startsWith("notion_")) {
    return executeNotionTool(name, input);
  }

  try {
    const result = await executeToolInternal(name, input);
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

async function executeToolInternal(
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const client = getTodoistClient();

  switch (name) {
    case "list_tasks": {
      // Use REST API directly for filter support
      const token = config.todoist.apiToken();
      let url = "https://api.todoist.com/rest/v2/tasks";

      if (input.filter) {
        url += `?filter=${encodeURIComponent(String(input.filter))}`;
      }

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`Todoist API error: ${response.status}`);
      }

      const tasks = await response.json() as Array<{
        id: string;
        content: string;
        project_id: string;
        priority: number;
        due?: { date: string; string: string } | null;
      }>;

      let filtered = tasks;

      if (input.project_name) {
        const projectsResponse = await client.getProjects() as unknown as TodoistResponse<TodoistProject>;
        const projects = projectsResponse.results;
        const project = projects.find(
          (p) => p.name.toLowerCase() === String(input.project_name).toLowerCase()
        );
        if (project) {
          filtered = tasks.filter((t) => t.project_id === project.id);
        }
      }

      return filtered.map((t) => ({
        id: t.id,
        content: t.content,
        due: t.due?.string || null,
        due_date: t.due?.date || null,
        priority: t.priority,
        project_id: t.project_id,
      }));
    }

    case "create_task": {
      let projectId: string | undefined;

      if (input.project_name) {
        const projectsResponse = await client.getProjects() as unknown as TodoistResponse<TodoistProject>;
        const projects = projectsResponse.results;
        const project = projects.find(
          (p) => p.name.toLowerCase() === String(input.project_name).toLowerCase()
        );
        if (project) {
          projectId = project.id;
        }
      }

      const task = await client.addTask({
        content: String(input.content),
        dueString: input.due_string ? String(input.due_string) : undefined,
        priority: input.priority ? Number(input.priority) : undefined,
        projectId,
      }) as unknown as TodoistTask;

      return {
        id: task.id,
        content: task.content,
        due: task.due?.string || null,
        priority: task.priority,
      };
    }

    case "complete_task": {
      let taskId = input.task_id ? String(input.task_id) : null;

      if (!taskId && input.search_content) {
        const tasksResponse = await client.getTasks() as unknown as TodoistResponse<TodoistTask>;
        const tasks = tasksResponse.results;
        const searchLower = String(input.search_content).toLowerCase();
        const match = tasks.find((t) => t.content.toLowerCase().includes(searchLower));
        if (match) {
          taskId = match.id;
        } else {
          throw new Error(`No task found matching: ${input.search_content}`);
        }
      }

      if (!taskId) {
        throw new Error("Must provide either task_id or search_content");
      }

      await client.closeTask(taskId);
      return { success: true, completed_task_id: taskId };
    }

    case "update_task": {
      const taskId = String(input.task_id);
      const token = config.todoist.apiToken();

      // Build update payload with REST API field names
      const updates: Record<string, unknown> = {};
      if (input.content) updates.content = String(input.content);
      if (input.due_string) {
        updates.due_string = String(input.due_string);
        updates.due_lang = "en";
      }
      if (input.priority) updates.priority = Number(input.priority);

      const response = await fetch(`https://api.todoist.com/rest/v2/tasks/${taskId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Todoist API error ${response.status}: ${errorText}`);
      }

      const task = await response.json() as {
        id: string;
        content: string;
        priority: number;
        due?: { date: string; string: string } | null;
      };

      return {
        id: task.id,
        content: task.content,
        due: task.due?.string || null,
        priority: task.priority,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
