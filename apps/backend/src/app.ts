import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import "./db/client.js";
import { browsersRoutes } from "./api/browsers.js";
import { commandsRoutes } from "./api/commands.js";
import { chatRoutes } from "./api/chat.js";
import { agentRoutes } from "./api/agent.js";
import { logsRoutes } from "./api/logs.js";
import { workflowsRoutes } from "./api/workflows.js";
import { isAiConfigured } from "./services/aiService.js";
import { tokenOk, tokenFromHeaders } from "./util/auth.js";

/** Build the Fastify app (REST routes + auth). Split from index.ts so tests can inject(). */
export async function buildApp() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  // Same pairing-token rule as the WS handshake. /health stays open (no data, useful for probes).
  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health" || req.method === "OPTIONS") return;
    if (!tokenOk(tokenFromHeaders(req.headers))) {
      return reply.code(401).send({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Invalid or missing pairing token (Authorization: Bearer <PAIRING_TOKEN>)." },
      });
    }
  });

  app.get("/health", async () => ({
    ok: true,
    service: "browserpilot",
    time: new Date().toISOString(),
    aiConfigured: isAiConfigured(),
    aiProvider: config.ai.provider,
  }));

  await app.register(browsersRoutes);
  await app.register(commandsRoutes);
  await app.register(chatRoutes);
  await app.register(agentRoutes);
  await app.register(logsRoutes);
  await app.register(workflowsRoutes);

  return app;
}
