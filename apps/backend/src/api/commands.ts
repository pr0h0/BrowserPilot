import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";

export async function commandsRoutes(app: FastifyInstance) {
  app.get("/api/commands/:commandId", async (req, reply) => {
    const { commandId } = req.params as { commandId: string };
    const row = db.select().from(schema.commands).where(eq(schema.commands.id, commandId)).get();
    if (!row) return reply.code(404).send({ error: { code: "TAB_NOT_FOUND", message: "command not found" } });
    return {
      ...row,
      payload: safe(row.payloadJson), result: safe(row.resultJson), error: safe(row.errorJson),
    };
  });
}

const safe = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
