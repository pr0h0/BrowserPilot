// Bun auto-loads .env. We resolve config once here.
const env = process.env;

export const config = {
  nodeEnv: env.NODE_ENV ?? "development",
  port: Number(env.PORT ?? 9876),
  databaseUrl: (env.DATABASE_URL ?? "file:./data/browserpilot.sqlite").replace(/^file:/, ""),
  pairingToken: env.PAIRING_TOKEN ?? "",
  screenshotDir: env.SCREENSHOT_DIR ?? "./data/screenshots",
  ai: {
    // provider: openai | deepseek | openrouter | anthropic. openai/deepseek/openrouter
    // all speak the OpenAI chat-completions API; anthropic uses its native messages API.
    provider: (env.AI_PROVIDER ?? "openai").toLowerCase(),
    apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
    baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    model: env.OPENAI_MODEL ?? "gpt-4.1-mini",
  },
  get isDev() { return this.nodeEnv === "development"; },
};

export type Config = typeof config;
