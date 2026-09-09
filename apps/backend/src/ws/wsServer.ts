import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { helloSchema, responseSchema, pingSchema, eventSchema, type Hello } from "@browserpilot/protocol";
import { db, schema } from "../db/client.js";
import { now } from "../util/ids.js";
import { registry } from "./connectionRegistry.js";
import { audit } from "../services/auditLogService.js";
import { redactSensitiveData } from "../util/redaction.js";
import { tokenOk } from "../util/auth.js";
import { config } from "../config.js";
import { isLockedOut, recordAuthFailure, clearAuthFailures } from "../util/rateLimit.js";
import { log } from "../util/logger.js";

const authOk = (hello: Hello) => tokenOk(hello.token);

function onHello(ws: WebSocket, hello: Hello, ip = "unknown") {
  // Same order as the REST hook: a valid token is never locked out.
  if (!authOk(hello) && isLockedOut(ip)) {
    ws.send(JSON.stringify({ type: "hello.ack", ok: false, serverTime: new Date().toISOString(), sessionId: "", error: "Too many failed auth attempts" }));
    ws.close(4029, "rate limited");
    return;
  }
  if (!authOk(hello)) {
    ws.send(JSON.stringify({ type: "hello.ack", ok: false, serverTime: new Date().toISOString(), sessionId: "", error: "Invalid or missing pairing token" }));
    const n = recordAuthFailure(ip);
    // browserId/browserName here are client-supplied and therefore untrustworthy; the IP is not.
    audit("auth:rejected", hello.browserId, { surface: "ws", ip, browserName: hello.browserName, attempt: n });
    log.warn(`ws auth rejected from ${ip} (${n} failure${n === 1 ? "" : "s"} in window)`);
    ws.close(4001, "auth failed");
    return;
  }
  clearAuthFailures(ip);
  const sessionId = `session_${Math.abs(hashCode(hello.browserId + now())).toString(36)}`;
  registry.add({
    browserId: hello.browserId, name: hello.browserName, extensionVersion: hello.extensionVersion,
    capabilities: hello.capabilities, ws, sessionId, lastSeenAt: now(),
  });

  // Upsert browser row.
  const existing = db.select().from(schema.browsers).where(eq(schema.browsers.id, hello.browserId)).get();
  const base = { name: hello.browserName, extensionVersion: hello.extensionVersion, capabilitiesJson: JSON.stringify(hello.capabilities), status: "online", lastSeenAt: now(), updatedAt: now() };
  if (existing) db.update(schema.browsers).set(base).where(eq(schema.browsers.id, hello.browserId)).run();
  else db.insert(schema.browsers).values({ id: hello.browserId, ...base, createdAt: now() }).run();

  ws.send(JSON.stringify({ type: "hello.ack", ok: true, serverTime: new Date().toISOString(), sessionId }));
  audit("browser:connected", hello.browserId, { browserName: hello.browserName, capabilities: hello.capabilities });
  log.info(`browser online: ${hello.browserName} (${hello.browserId})`);
}

function persistEvent(browserId: string | undefined, evt: { event: string; data: Record<string, unknown> }) {
  if (!browserId) return;
  const d = redactSensitiveData(evt.data) as Record<string, any>;
  if (evt.event === "console") {
    db.insert(schema.consoleEvents).values({
      id: `ce_${Math.random().toString(36).slice(2, 12)}`, browserId, tabId: d.tabId ?? null, url: d.url ?? null,
      level: d.level ?? "error", message: String(d.message ?? ""), source: d.source ?? null, line: d.line ?? null,
      column: d.column ?? null, stack: d.stack ?? null, createdAt: now(),
    }).run();
  } else if (evt.event === "network") {
    db.insert(schema.networkEvents).values({
      id: `ne_${Math.random().toString(36).slice(2, 12)}`, browserId, tabId: d.tabId ?? null, url: d.url ?? null,
      method: d.method ?? null, status: d.status ?? null, requestUrl: d.requestUrl ?? d.url ?? null,
      errorText: d.errorText ?? null, durationMs: d.durationMs ?? null,
      requestHeadersJson: d.requestHeaders ? JSON.stringify(d.requestHeaders) : null,
      responseHeadersJson: d.responseHeaders ? JSON.stringify(d.responseHeaders) : null, createdAt: now(),
    }).run();
  }
}

export function attachWsServer(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    // Behind a proxy the socket IP is the proxy's; honour the forwarded header when we've been
    // told to trust it, so the throttle counts real clients.
    const fwd = config.trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
    const ip = fwd || req.socket.remoteAddress || "unknown";
    let browserId: string | undefined;
    ws.on("message", (raw) => {
      let msg: unknown;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const type = (msg as any)?.type;

      if (type === "hello") {
        const parsed = helloSchema.safeParse(msg);
        if (!parsed.success) { ws.close(4002, "bad hello"); return; }
        browserId = parsed.data.browserId;
        onHello(ws, parsed.data, ip);
      } else if (type === "ping") {
        if (pingSchema.safeParse(msg).success) {
          if (browserId) registry.touch(browserId);
          ws.send(JSON.stringify({ type: "pong", t: (msg as any).t }));
        }
      } else if (type === "event") {
        if (browserId) registry.touch(browserId);
        const parsed = eventSchema.safeParse(msg);
        if (parsed.success) persistEvent(browserId, parsed.data);
      } else {
        // command response
        const parsed = responseSchema.safeParse(msg);
        if (parsed.success) {
          if (browserId) registry.touch(browserId);
          registry.resolvePending(parsed.data);
        }
      }
    });

    ws.on("close", () => {
      const bid = registry.removeByWs(ws);
      if (bid) {
        db.update(schema.browsers).set({ status: "offline", updatedAt: now() }).where(eq(schema.browsers.id, bid)).run();
        audit("browser:disconnected", bid, {});
      }
    });
    ws.on("error", (e) => log.warn("ws error", e));
  });

  // Mark stale browsers offline (no heartbeat for 60s). unref: don't keep the process alive.
  setInterval(() => {
    for (const s of registry.all()) {
      if (now() - s.lastSeenAt > 60_000) {
        db.update(schema.browsers).set({ status: "offline", updatedAt: now() }).where(eq(schema.browsers.id, s.browserId)).run();
      }
    }
  }, 15_000).unref?.();

  return wss;
}

function hashCode(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; }
