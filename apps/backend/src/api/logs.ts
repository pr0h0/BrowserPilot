import type { FastifyInstance } from "fastify";
import { eq, desc, and } from "drizzle-orm";
import { db, schema } from "../db/client.js";

export async function logsRoutes(app: FastifyInstance) {
  app.get("/api/logs/console", async (req) => {
    const { browserId, limit } = req.query as { browserId?: string; limit?: string };
    const lim = Math.min(Number(limit ?? 200), 1000);
    const where = browserId ? eq(schema.consoleEvents.browserId, browserId) : undefined;
    return db.select().from(schema.consoleEvents).where(where).orderBy(desc(schema.consoleEvents.createdAt)).limit(lim).all();
  });

  app.get("/api/logs/network", async (req) => {
    const { browserId, limit } = req.query as { browserId?: string; limit?: string };
    const lim = Math.min(Number(limit ?? 200), 1000);
    const where = browserId ? eq(schema.networkEvents.browserId, browserId) : undefined;
    const rows = db.select().from(schema.networkEvents).where(where).orderBy(desc(schema.networkEvents.createdAt)).limit(lim).all();
    return rows.map((r) => ({ ...r, requestHeaders: safe(r.requestHeadersJson), responseHeaders: safe(r.responseHeadersJson) }));
  });
}

const safe = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
void and;
