function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  telegram: {
    token: () => requireEnv("TELEGRAM_BOT_TOKEN"),
  },
  anthropic: {
    apiKey: () => requireEnv("ANTHROPIC_API_KEY"),
  },
  todoist: {
    apiToken: () => requireEnv("TODOIST_API_TOKEN"),
  },
};
