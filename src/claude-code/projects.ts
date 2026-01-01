import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { ClaudeCodeConfig } from "./types.js";

const CONFIG_PATH = "./data/claude-code-config.json";

class ProjectManager {
  private config: ClaudeCodeConfig;

  constructor() {
    this.config = this.loadConfig();
    console.log(`[ProjectManager] Loaded config:`, this.config);
  }

  private loadConfig(): ClaudeCodeConfig {
    if (!existsSync(CONFIG_PATH)) {
      const defaultConfig: ClaudeCodeConfig = {
        allowedUserId: "",
        projects: {},
      };
      this.ensureDataDir();
      writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  }

  private ensureDataDir(): void {
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  reload(): void {
    this.config = this.loadConfig();
  }

  isAuthorizedUser(userId: string): boolean {
    return this.config.allowedUserId === userId;
  }

  getProject(name: string): string | undefined {
    return this.config.projects[name.toLowerCase()];
  }

  listProjects(): Array<{ name: string; path: string }> {
    return Object.entries(this.config.projects).map(([name, path]) => ({
      name,
      path,
    }));
  }

  projectExists(name: string): boolean {
    return name.toLowerCase() in this.config.projects;
  }
}

export const projectManager = new ProjectManager();
