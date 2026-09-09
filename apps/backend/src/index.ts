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
if (!config.pairingToken && config.allowNoToken) log.warn("ALLOW_NO_TOKEN=1 — NO AUTHENTICATION. Anything that can reach this port controls the browser.");
if (!config.pairingToken && !config.allowNoToken) log.warn("No PAIRING_TOKEN set — every request and connection will be rejected. Set one, or ALLOW_NO_TOKEN=1 for local dev.");
if (config.host !== "127.0.0.1" && config.host !== "localhost" && !config.pairingToken) log.warn(`Listening on ${config.host} with no token.`);
if (!isAiConfigured()) log.warn("AI not configured — /api/chat will return AI_NOT_CONFIGURED.");
