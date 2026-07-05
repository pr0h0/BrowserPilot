import type { FastifyInstance } from "fastify";
import { agentRunSchema, agentApproveSchema, agentStopSchema } from "@browserpilot/protocol";
import { agentRun, agentApprove, agentStop, agentEvents } from "../services/agentService.js";
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

  app.post("/api/agent/stop", async (req, reply) => {
    const parsed = agentStopSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ status: "error", error: { code: "INVALID_COMMAND", message: "validation failed" } });
    return agentStop(parsed.data.runId);
  });

  // Poll for streamed events: /api/agent/events?runId=...&since=<cursor>
  app.get("/api/agent/events", async (req, reply) => {
    const { runId, since } = req.query as { runId?: string; since?: string };
    if (!runId) return reply.code(400).send({ status: "error", error: { code: "INVALID_COMMAND", message: "runId required" } });
    const out = agentEvents(runId, Number(since ?? 0));
    if (!out) return reply.code(404).send({ status: "error", error: { code: "UNKNOWN_ERROR", message: "run not found or expired" } });
    return out;
  });
}

function errReply(reply: any, e: unknown) {
  if (e instanceof AiError) return reply.code(e.code === "AI_NOT_CONFIGURED" ? 503 : 502).send({ status: "error", error: { code: e.code, message: e.message } });
  return reply.code(500).send({ status: "error", error: { code: "UNKNOWN_ERROR", message: String(e) } });
}
