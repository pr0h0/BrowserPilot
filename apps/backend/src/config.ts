import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Bun auto-loads .env. We resolve config once here.
const env = process.env;

// Relative DATABASE_URL/SCREENSHOT_DIR are resolved against apps/backend (not CWD),
// so running from the repo root and from apps/backend hits the same files.
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fromBackendRoot = (p: string) => resolve(backendRoot, p);

export const config = {
  nodeEnv: env.NODE_ENV ?? "development",
  host: env.HOST ?? "127.0.0.1",
  port: Number(env.PORT ?? 9876),
  databaseUrl: fromBackendRoot((env.DATABASE_URL ?? "file:./data/browserpilot.sqlite").replace(/^file:/, "")),
  pairingToken: env.PAIRING_TOKEN ?? "",
  // Escape hatch for local dev / the E2E harness: run with NO auth at all. Never set this on an
  // instance anything but localhost can reach.
  allowNoToken: env.ALLOW_NO_TOKEN === "1",
  // Behind a reverse proxy, req.ip is the proxy unless we trust its forwarded headers — without
  // this the auth throttle would rate-limit the proxy as a single client.
  trustProxy: env.TRUST_PROXY === "1",
  // Extra browser origins allowed to call the API (comma-separated). Extension origins are
  // always allowed; a wide-open reflector is not.
  corsOrigins: (env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  screenshotDir: fromBackendRoot(env.SCREENSHOT_DIR ?? "./data/screenshots"),
  // Extra domains the agent may never act on, comma-separated (added to DEFAULT_BLOCKED_SITES).
  blockedSites: (env.BLOCKED_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  ai: {
    // provider: openai | deepseek | openrouter | anthropic. openai/deepseek/openrouter
    // all speak the OpenAI chat-completions API; anthropic uses its native messages API.
    provider: (env.AI_PROVIDER ?? "openai").toLowerCase(),
    apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
    baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    model: env.OPENAI_MODEL ?? "gpt-4.1-mini",
    // Output ceiling per turn. The old hard-coded 1024 truncated agent turns mid-thought.
    maxTokens: Number(env.AI_MAX_TOKENS ?? 16000),
  },
  get isDev() { return this.nodeEnv === "development"; },
};

export type Config = typeof config;
