import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { workflowRunSchema, commandTypeSchema } from "@browserpilot/protocol";
import { runWorkflow } from "../services/workflowRunner.js";
import { db, schema } from "../db/client.js";
import { eq } from "drizzle-orm";
import { id as newId } from "../util/ids.js";

const stepSchema = z.object({
  type: commandTypeSchema,
  payload: z.record(z.unknown()).optional(),
  label: z.string().optional(),
});
const saveSchema = z.object({ name: z.string().min(1).max(80), steps: z.array(stepSchema).min(1) });

const row = (r: typeof schema.workflows.$inferSelect) => ({
  id: r.id, name: r.name, steps: JSON.parse(r.steps) as unknown[],
  createdAt: r.createdAt, lastRunAt: r.lastRunAt, lastStatus: r.lastStatus,
});

export async function workflowsRoutes(app: FastifyInstance) {
  app.post("/api/workflows/run", async (req, reply) => {
    const parsed = workflowRunSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: { code: "INVALID_COMMAND", message: "validation failed", details: parsed.error.flatten() } });
    const out = await runWorkflow(parsed.data);
    return reply.code(out.ok ? 200 : 502).send(out);
  });

  app.get("/api/workflows", async () => db.select().from(schema.workflows).all().map(row));

  // Save a recording. Steps are validated against the command whitelist here rather than
  // trusted from the extension — this endpoint is what later replays them.
  app.post("/api/workflows", async (req, reply) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: { code: "INVALID_COMMAND", message: "validation failed", details: parsed.error.flatten() } });
    const rec = { id: newId("wf"), name: parsed.data.name, steps: JSON.stringify(parsed.data.steps), createdAt: Date.now(), lastRunAt: null, lastStatus: null };
    db.insert(schema.workflows).values(rec).run();
    return { ok: true, workflow: row(rec as any) };
  });

  app.delete("/api/workflows/:id", async (req) => {
    const { id } = req.params as { id: string };
    db.delete(schema.workflows).where(eq(schema.workflows.id, id)).run();
    return { ok: true, deleted: id };
  });

  // Replay a saved workflow against a browser.
  app.post("/api/workflows/:id/run", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { browserId, tabId } = (req.body ?? {}) as { browserId?: string; tabId?: number };
    if (!browserId) return reply.code(400).send({ ok: false, error: { code: "INVALID_COMMAND", message: "browserId required" } });
    const found = db.select().from(schema.workflows).where(eq(schema.workflows.id, id)).get();
    if (!found) return reply.code(404).send({ ok: false, error: { code: "TAB_NOT_FOUND", message: "no such workflow" } });
    const steps = (JSON.parse(found.steps) as any[]).map((st) => ({ ...st, target: tabId !== undefined ? { tabId } : undefined }));
    const out = await runWorkflow({ browserId, steps } as any);
    db.update(schema.workflows).set({ lastRunAt: Date.now(), lastStatus: out.ok ? "ok" : "failed" }).where(eq(schema.workflows.id, id)).run();
    return reply.code(out.ok ? 200 : 502).send(out);
  });
}
