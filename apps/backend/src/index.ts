import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import "./db/client.js";
import { attachWsServer } from "./ws/wsServer.js";
import { browsersRoutes } from "./api/browsers.js";
import { commandsRoutes } from "./api/commands.js";
import { chatRoutes } from "./api/chat.js";
import { agentRoutes } from "./api/agent.js";
import { logsRoutes } from "./api/logs.js";
import { workflowsRoutes } from "./api/workflows.js";
import { isAiConfigured } from "./services/aiService.js";
import { log } from "./util/logger.js";

const app = Fastify({ logger: false });

await app.register(cors, { origin: true });

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

await app.listen({ port: config.port, host: "0.0.0.0" });
attachWsServer(app.server);

log.info(`BrowserPilot backend on http://localhost:${config.port}  (ws: ws://localhost:${config.port}/ws)`);
if (!config.pairingToken && config.isDev) log.warn("No PAIRING_TOKEN set — dev mode allows token-less connections.");
if (!isAiConfigured()) log.warn("AI not configured — /api/chat will return AI_NOT_CONFIGURED.");
