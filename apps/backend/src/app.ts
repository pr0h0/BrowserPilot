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
import { permissionsRoutes } from "./api/permissions.js";
import { schedulesRoutes } from "./api/schedules.js";
import { activityRoutes } from "./api/activity.js";
import { tokenOk, tokenFromHeaders } from "./util/auth.js";
import { isLockedOut, recordAuthFailure, clearAuthFailures, MAX_FAILURES } from "./util/rateLimit.js";
import { audit } from "./services/auditLogService.js";
import { log } from "./util/logger.js";

/** Build the Fastify app (REST routes + auth). Split from index.ts so tests can inject(). */
export async function buildApp() {
  const app = Fastify({ logger: false, trustProxy: config.trustProxy });

  // Only the extension's own pages (and any origin the operator names) may call this from a
  // browser. `origin: true` reflected whatever asked, which let any page you happened to visit
  // try its luck against localhost.
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);                       // curl, the extension SW, native clients
      if (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://")) return cb(null, true);
      cb(null, config.corsOrigins.includes(origin));
    },
  });

  // Same pairing-token rule as the WS handshake. Everything except the two endpoints below
  // requires the token — including any route added later, since this is a global hook.
  const PUBLIC_ROUTES = new Set(["/health"]);
  app.addHook("onRequest", async (req, reply) => {
    // CORS preflight carries no credentials by design; it never reaches a handler.
    if (req.method === "OPTIONS") return;
    if (PUBLIC_ROUTES.has(req.url.split("?")[0])) return;

    const ip = req.ip || "unknown";
    // Token first, throttle second. Checking the lockout first would let a stranger hammering
    // your endpoint lock YOU out of your own instance — the throttle exists to stop guessing,
    // and someone presenting the right token is by definition not guessing.
    if (tokenOk(tokenFromHeaders(req.headers))) { clearAuthFailures(ip); return; }
    // Throttled callers are NOT recorded: the throttle short-circuits before recordAuthFailure,
    // which is what stops a spray from writing a DB row per request. That caps the audit trail at
    // MAX_FAILURES rows per IP per window while still showing that someone tried.
    if (isLockedOut(ip)) {
      return reply.code(429).send({ ok: false, error: { code: "TOO_MANY_ATTEMPTS", message: "Too many failed auth attempts. Try again later." } });
    }
    const n = recordAuthFailure(ip);
    const path = req.url.split("?")[0];
    // Never record the presented token — only whether one was offered at all.
    audit(n >= MAX_FAILURES ? "auth:locked" : "auth:rejected", null,
      // "credentialOffered", not "tokenPresented": the redactor blanks any key containing
      // "token", which would have silently turned this flag into "[REDACTED]".
      { surface: "rest", ip, method: req.method, path, credentialOffered: Boolean(tokenFromHeaders(req.headers)), attempt: n });
    log.warn(`auth rejected from ${ip} (${n} failure${n === 1 ? "" : "s"} in window) ${req.method} ${path}`);
    return reply.code(401).send({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Invalid or missing pairing token (Authorization: Bearer <PAIRING_TOKEN>)." },
    });
  });

  // Public on purpose (uptime probes, proxy health checks) — so it says nothing about how this
  // instance is configured. Which model provider is in use is not a stranger's business.
  app.get("/health", async () => ({ ok: true, service: "browserpilot", time: new Date().toISOString() }));

  await app.register(browsersRoutes);
  await app.register(commandsRoutes);
  await app.register(chatRoutes);
  await app.register(agentRoutes);
  await app.register(logsRoutes);
  await app.register(workflowsRoutes);
  await app.register(permissionsRoutes);
  await app.register(schedulesRoutes);
  await app.register(activityRoutes);

  return app;
}
