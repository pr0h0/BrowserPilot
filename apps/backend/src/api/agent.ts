import type { FastifyInstance } from "fastify";
import { agentRunSchema, agentApproveSchema } from "@browserpilot/protocol";
import { agentRun, agentApprove } from "../services/agentService.js";
import { AiError, isAiConfigured } from "../services/aiService.js";

export async function agentRoutes(app: FastifyInstance) {
  app.post("/api/agent/run", async (req, reply) => {
    const parsed = agentRunSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ status: "error", error: { code: "INVALID_COMMAND", message: "validation failed", details: parsed.error.flatten() } });
    if (!isAiConfigured()) return reply.code(503).send({ status: "error", error: { code: "AI_NOT_CONFIGURED", message: "Set OPENAI_API_KEY or ANTHROPIC_API_KEY to enable the agent." } });
    try { return await agentRun(parsed.data); }
    catch (e) { return errReply(reply, e); }
  });

  app.post("/api/agent/approve", async (req, reply) => {
    const parsed = agentApproveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ status: "error", error: { code: "INVALID_COMMAND", message: "validation failed" } });
    try { return await agentApprove(parsed.data.runId, parsed.data.approve); }
    catch (e) { return errReply(reply, e); }
  });
}

function errReply(reply: any, e: unknown) {
  if (e instanceof AiError) return reply.code(e.code === "AI_NOT_CONFIGURED" ? 503 : 502).send({ status: "error", error: { code: e.code, message: e.message } });
  return reply.code(500).send({ status: "error", error: { code: "UNKNOWN_ERROR", message: String(e) } });
}
