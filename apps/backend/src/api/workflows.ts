import type { FastifyInstance } from "fastify";
import { workflowRunSchema } from "@browserpilot/protocol";
import { runWorkflow } from "../services/workflowRunner.js";

export async function workflowsRoutes(app: FastifyInstance) {
  app.post("/api/workflows/run", async (req, reply) => {
    const parsed = workflowRunSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: { code: "INVALID_COMMAND", message: "validation failed", details: parsed.error.flatten() } });
    const out = await runWorkflow(parsed.data);
    return reply.code(out.ok ? 200 : 502).send(out);
  });
}
