import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { minimatch } from "minimatch";
import type { PermissionRule, PermissionMemory, ProjectPermissions } from "./types.js";

const PERMISSIONS_PATH = "./data/claude-code-permissions.json";

class PermissionManager {
  private memory: PermissionMemory;

  constructor() {
    this.memory = this.loadMemory();
  }

  private loadMemory(): PermissionMemory {
    if (!existsSync(PERMISSIONS_PATH)) {
      this.ensureDataDir();
      writeFileSync(PERMISSIONS_PATH, "{}");
      return {};
    }
    return JSON.parse(readFileSync(PERMISSIONS_PATH, "utf-8"));
  }

  private ensureDataDir(): void {
    const dir = dirname(PERMISSIONS_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private save(): void {
    writeFileSync(PERMISSIONS_PATH, JSON.stringify(this.memory, null, 2));
  }

  private ensureProject(projectName: string): void {
    if (!this.memory[projectName]) {
      this.memory[projectName] = { allowed: [], denied: [] };
    }
  }

  checkPermission(
    projectName: string,
    toolName: string,
    input: Record<string, unknown>
  ): "allowed" | "denied" | "ask" {
    const permissions = this.memory[projectName];
    if (!permissions) return "ask";

    // Check denied rules first (they take precedence)
    for (const rule of permissions.denied) {
      if (this.matchesRule(rule, toolName, input)) {
        return "denied";
      }
    }

    // Check allowed rules
    for (const rule of permissions.allowed) {
      if (this.matchesRule(rule, toolName, input)) {
        return "allowed";
      }
    }

    return "ask";
  }

  private matchesRule(
    rule: PermissionRule,
    toolName: string,
    input: Record<string, unknown>
  ): boolean {
    if (rule.tool !== toolName) return false;

    // For file operations, match against file path
    if (rule.pattern && "file_path" in input) {
      return minimatch(String(input.file_path), rule.pattern);
    }

    // For Bash commands
    if (toolName === "Bash" && input.command) {
      const cmd = String(input.command);
      if (rule.command && cmd === rule.command) return true;
      if (rule.commandPattern && new RegExp(rule.commandPattern).test(cmd)) return true;
    }

    // If no pattern specified, match all uses of this tool
    if (!rule.pattern && !rule.command && !rule.commandPattern) {
      return true;
    }

    return false;
  }

  remember(
    projectName: string,
    toolName: string,
    input: Record<string, unknown>,
    allowed: boolean
  ): void {
    this.ensureProject(projectName);

    const rule = this.createRule(toolName, input);
    const list = allowed
      ? this.memory[projectName].allowed
      : this.memory[projectName].denied;

    // Avoid duplicates
    const exists = list.some(
      (r) =>
        r.tool === rule.tool &&
        r.pattern === rule.pattern &&
        r.command === rule.command
    );

    if (!exists) {
      list.push(rule);
      this.save();
    }
  }

  private createRule(toolName: string, input: Record<string, unknown>): PermissionRule {
    const rule: PermissionRule = { tool: toolName };

    // For file operations, create pattern based on file path
    if ("file_path" in input) {
      const path = String(input.file_path);
      const parts = path.split("/");
      const file = parts.pop()!;
      const ext = file.includes(".") ? file.split(".").pop() : "";
      if (ext) {
        rule.pattern = `${parts.join("/")}/**/*.${ext}`;
      } else {
        rule.pattern = path;
      }
    }

    // For Bash, remember exact command
    if (toolName === "Bash" && input.command) {
      rule.command = String(input.command);
    }

    return rule;
  }

  clearProject(projectName: string): void {
    delete this.memory[projectName];
    this.save();
  }

  getProjectPermissions(projectName: string): ProjectPermissions | undefined {
    return this.memory[projectName];
  }
}

export const permissionManager = new PermissionManager();
