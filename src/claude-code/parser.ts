import { projectManager } from "./projects.js";

interface ClaudeCodeCommand {
  type: "claude-code";
  projectName: string;
  prompt: string;
}

interface ListProjectsCommand {
  type: "list-projects";
}

interface ClearSessionCommand {
  type: "clear-session";
  projectName: string;
}

interface ClearPermissionsCommand {
  type: "clear-permissions";
  projectName: string;
}

export type ParsedCommand =
  | ClaudeCodeCommand
  | ListProjectsCommand
  | ClearSessionCommand
  | ClearPermissionsCommand
  | null;

/**
 * Parse user message for Claude Code commands.
 *
 * Supported patterns:
 * - "cc <prompt>" - uses default project
 * - "@<project> <prompt>"
 * - "in <project>, <prompt>"
 * - "in <project>: <prompt>"
 * - "/code <project> <prompt>"
 * - "/projects" - list available projects
 * - "/code-clear <project>" - clear session for project
 * - "/code-permissions <project>" - clear permissions for project
 */
export function parseClaudeCodeCommand(text: string): ParsedCommand {
  const trimmed = text.trim();

  // "cc <prompt>" - uses default project (first configured project)
  const ccMatch = trimmed.match(/^cc\s+(.+)$/is);
  if (ccMatch) {
    const projects = projectManager.listProjects();
    if (projects.length > 0) {
      const defaultProject = projects[0].name;
      console.log(`[Parser] cc shorthand detected, using default project: ${defaultProject}`);
      return { type: "claude-code", projectName: defaultProject, prompt: ccMatch[1].trim() };
    }
  }

  // /projects command
  if (trimmed.toLowerCase() === "/projects") {
    return { type: "list-projects" };
  }

  // /code-clear <project>
  const clearMatch = trimmed.match(/^\/code-clear\s+(\S+)$/i);
  if (clearMatch) {
    return { type: "clear-session", projectName: clearMatch[1].toLowerCase() };
  }

  // /code-permissions <project>
  const permMatch = trimmed.match(/^\/code-permissions\s+(\S+)$/i);
  if (permMatch) {
    return { type: "clear-permissions", projectName: permMatch[1].toLowerCase() };
  }

  // /code <project> <prompt>
  const codeMatch = trimmed.match(/^\/code\s+(\S+)\s+(.+)$/is);
  if (codeMatch) {
    const projectName = codeMatch[1].toLowerCase();
    if (projectManager.projectExists(projectName)) {
      return { type: "claude-code", projectName, prompt: codeMatch[2].trim() };
    }
  }

  // @<project> <prompt>
  const atMatch = trimmed.match(/^@(\S+)\s+(.+)$/is);
  if (atMatch) {
    const projectName = atMatch[1].toLowerCase();
    console.log(`[Parser] @mention detected: project="${projectName}", exists=${projectManager.projectExists(projectName)}`);
    if (projectManager.projectExists(projectName)) {
      return { type: "claude-code", projectName, prompt: atMatch[2].trim() };
    }
  }

  // "in <project>, <prompt>" or "in <project>: <prompt>"
  const inMatch = trimmed.match(/^in\s+(\S+)[,:]\s*(.+)$/is);
  if (inMatch) {
    const projectName = inMatch[1].toLowerCase();
    if (projectManager.projectExists(projectName)) {
      return { type: "claude-code", projectName, prompt: inMatch[2].trim() };
    }
  }

  return null;
}
