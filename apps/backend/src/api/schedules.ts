import type { FastifyInstance } from "fastify";
import { scheduleSchema } from "@browserpilot/protocol";
import { listSchedules, createSchedule, deleteSchedule, setScheduleEnabled } from "../services/scheduleService.js";

export async function schedulesRoutes(app: FastifyInstance) {
  app.get("/api/schedules", async () => listSchedules());

  app.post("/api/schedules", async (req, reply) => {
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: { code: "INVALID_COMMAND", message: "validation failed", details: parsed.error.flatten() } });
    return { ok: true, schedule: createSchedule(parsed.data) };
  });

  app.patch("/api/schedules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { enabled } = (req.body ?? {}) as { enabled?: boolean };
    if (typeof enabled !== "boolean") return reply.code(400).send({ ok: false, error: { code: "INVALID_COMMAND", message: "enabled:boolean required" } });
    return setScheduleEnabled(id, enabled);
  });

  app.delete("/api/schedules/:id", async (req) => {
    const { id } = req.params as { id: string };
    return deleteSchedule(id);
  });
}
