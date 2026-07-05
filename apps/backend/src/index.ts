import { config } from "./config.js";
import { buildApp } from "./app.js";
import { attachWsServer } from "./ws/wsServer.js";
import { startScheduler } from "./services/scheduleService.js";
import { isAiConfigured } from "./services/aiService.js";
import { log } from "./util/logger.js";

const app = await buildApp();
// Default 127.0.0.1 — the REST API can drive the browser, keep it off the LAN unless HOST is set.
await app.listen({ port: config.port, host: config.host });
attachWsServer(app.server);
startScheduler();

log.info(`BrowserPilot backend on http://${config.host}:${config.port}  (ws: ws://${config.host}:${config.port}/ws)`);
if (!config.pairingToken && config.isDev) log.warn("No PAIRING_TOKEN set — dev mode allows token-less connections.");
if (!config.pairingToken && !config.isDev) log.warn("No PAIRING_TOKEN set and not in development — all connections/requests will be rejected.");
if (!isAiConfigured()) log.warn("AI not configured — /api/chat will return AI_NOT_CONFIGURED.");
