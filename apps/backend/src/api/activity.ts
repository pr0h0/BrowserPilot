import type { FastifyInstance } from "fastify";
import { eq, and, desc, like } from "drizzle-orm";
import { db, schema } from "../db/client.js";

const safe = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

export async function activityRoutes(app: FastifyInstance) {
  // Unified recent-activity feed (audit log + command lifecycle) for the History tab.
  app.get("/api/activity", async (req) => {
    // `action` accepts a prefix ("auth", "agent") so a security check is one call:
    //   GET /api/activity?action=auth  → every rejected/locked attempt, newest first.
    const { browserId, limit, action } = req.query as { browserId?: string; limit?: string; action?: string };
    const lim = Math.min(Number(limit ?? 100), 500);

    const filters = [
      browserId ? eq(schema.auditLogs.browserId, browserId) : undefined,
      action ? like(schema.auditLogs.action, `${action}%`) : undefined,
    ].filter(Boolean);

    const audits = db.select().from(schema.auditLogs)
      .where(filters.length ? and(...filters) : undefined)
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
