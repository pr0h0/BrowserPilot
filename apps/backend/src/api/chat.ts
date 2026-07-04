import type { FastifyInstance } from "fastify";
import { chatRequestSchema } from "@browserpilot/protocol";
import { runChat, AiError, isAiConfigured } from "../services/aiService.js";

export async function chatRoutes(app: FastifyInstance) {
  app.post("/api/chat", async (req, reply) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: { code: "INVALID_COMMAND", message: "validation failed", details: parsed.error.flatten() } });
    if (!isAiConfigured()) return reply.code(503).send({ ok: false, error: { code: "AI_NOT_CONFIGURED", message: "Set OPENAI_API_KEY or ANTHROPIC_API_KEY (and AI_PROVIDER) to enable AI chat." } });
    try {
      const out = await runChat(parsed.data);
      return { ok: true, ...out };
    } catch (e) {
      if (e instanceof AiError) return reply.code(e.code === "AI_NOT_CONFIGURED" ? 503 : 502).send({ ok: false, error: { code: e.code, message: e.message } });
      return reply.code(500).send({ ok: false, error: { code: "UNKNOWN_ERROR", message: String(e) } });
    }
  });
}
