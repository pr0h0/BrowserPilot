import type { FastifyInstance } from "fastify";
import { sitePermissionSchema } from "@browserpilot/protocol";
import { listSitePermissions, setSitePermission, deleteSitePermission } from "../services/permissionsService.js";
import { audit } from "../services/auditLogService.js";

export async function permissionsRoutes(app: FastifyInstance) {
  app.get("/api/permissions", async () => listSitePermissions());

  app.post("/api/permissions", async (req, reply) => {
    const parsed = sitePermissionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: { code: "INVALID_COMMAND", message: "validation failed", details: parsed.error.flatten() } });
    audit("permission:set", null, parsed.data);
    return { ok: true, ...setSitePermission(parsed.data) };
  });

  app.delete("/api/permissions/:domain", async (req) => {
    const { domain } = req.params as { domain: string };
    audit("permission:clear", null, { domain });
    return { ok: true, ...deleteSitePermission(domain) };
  });
}
