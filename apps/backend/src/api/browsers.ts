import type { FastifyInstance } from "fastify";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { registry } from "../ws/connectionRegistry.js";
import { executeCommand } from "../services/commandService.js";
import { restCommandSchema } from "@browserpilot/protocol";

export async function browsersRoutes(app: FastifyInstance) {
  app.get("/api/browsers", async () => {
    const rows = db.select().from(schema.browsers).orderBy(desc(schema.browsers.updatedAt)).all();
    return rows.map(withLiveness);
  });

  app.get("/api/browsers/:browserId", async (req, reply) => {
    const { browserId } = req.params as { browserId: string };
    const b = db.select().from(schema.browsers).where(eq(schema.browsers.id, browserId)).get();
    if (!b) return reply.code(404).send({ error: { code: "TAB_NOT_FOUND", message: "browser not found" } });
    return withLiveness(b);
  });

  app.get("/api/browsers/:browserId/tabs", async (req, reply) => {
    const { browserId } = req.params as { browserId: string };
    const { response } = await executeCommand(browserId, { type: "tabs.list" });
    if (!response.ok) return reply.code(502).send(response);
    return response.result;
  });

  app.post("/api/browsers/:browserId/commands", async (req, reply) => {
    const { browserId } = req.params as { browserId: string };
    const parsed = restCommandSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: { code: "INVALID_COMMAND", message: "validation failed", details: parsed.error.flatten() } });
    const { commandId, response } = await executeCommand(browserId, parsed.data);
    return reply.code(response.ok ? 200 : 502).send({ ok: response.ok, commandId, result: response.result, error: response.error });
  });
}

const parse = (s: string | null) => { try { return s ? JSON.parse(s) : []; } catch { return []; } };

/** Overlay live connection state on the stored row. lastSeenAt comes from the registry while the
 *  browser is connected (pings keep it current) and falls back to the DB's connect-time value
 *  once it isn't — persisting every ping would be a DB write per browser per interval for a
 *  number nobody reads between requests. */
const withLiveness = (b: typeof schema.browsers.$inferSelect) => ({
  ...b,
  online: registry.isOnline(b.id),
  lastSeenAt: registry.lastSeen(b.id) ?? b.lastSeenAt,
  capabilities: parse(b.capabilitiesJson),
});
