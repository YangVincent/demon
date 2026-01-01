export interface ClaudeCodeConfig {
  allowedUserId: string;
  projects: Record<string, string>; // name -> path mapping
}

export interface PermissionRule {
  tool: string;
  pattern?: string; // glob pattern for files
  command?: string; // exact command for Bash
  commandPattern?: string; // regex pattern for Bash commands
}

export interface ProjectPermissions {
  allowed: PermissionRule[];
  denied: PermissionRule[];
}

export type PermissionMemory = Record<string, ProjectPermissions>;

export interface ClaudeCodeRequest {
  id: string;
  chatId: string;
  userId: string;
  projectName: string;
  prompt: string;
  sessionId?: string;
}

export interface ClaudeCodePermissionRequest {
  requestId: string;
  chatId: string;
  projectName: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  description: string;
}

export interface ClaudeCodePermissionResponse {
  requestId: string;
  chatId: string;
  approved: boolean;
  rememberChoice: boolean;
}

export interface ClaudeCodeResponse {
  requestId: string;
  chatId: string;
  text: string;
  sessionId?: string;
  isPartial?: boolean;
}
