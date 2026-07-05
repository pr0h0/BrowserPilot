import type { FastifyInstance } from "fastify";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "../db/client.js";

const safe = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

export async function activityRoutes(app: FastifyInstance) {
  // Unified recent-activity feed (audit log + command lifecycle) for the History tab.
  app.get("/api/activity", async (req) => {
    const { browserId, limit } = req.query as { browserId?: string; limit?: string };
    const lim = Math.min(Number(limit ?? 100), 500);

    const audits = db.select().from(schema.auditLogs)
      .where(browserId ? eq(schema.auditLogs.browserId, browserId) : undefined)
      .orderBy(desc(schema.auditLogs.createdAt)).limit(lim).all();

    const items = audits.map((a) => ({
      id: a.id, kind: "audit" as const, action: a.action, browserId: a.browserId,
      details: safe(a.detailsJson), at: a.createdAt,
    }));
    return { items };
  });

  // Full command history (with redacted payloads/results) for a browser.
  app.get("/api/commands", async (req) => {
    const { browserId, limit } = req.query as { browserId?: string; limit?: string };
    const lim = Math.min(Number(limit ?? 100), 500);
    const rows = db.select().from(schema.commands)
      .where(browserId ? eq(schema.commands.browserId, browserId) : undefined)
      .orderBy(desc(schema.commands.createdAt)).limit(lim).all();
    return rows.map((r) => ({ ...r, payload: safe(r.payloadJson), result: safe(r.resultJson), error: safe(r.errorJson) }));
  });
}
