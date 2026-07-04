import type { RestCommand, CommandResponse } from "@browserpilot/protocol";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { id, now } from "../util/ids.js";
import { sendCommand } from "../ws/commandRouter.js";
import { registry } from "../ws/connectionRegistry.js";
import { storeScreenshot } from "./screenshotStore.js";
import { audit } from "./auditLogService.js";
import { redactSensitiveData } from "../util/redaction.js";
import { log } from "../util/logger.js";

export interface ExecOutcome {
  commandId: string;
  response: CommandResponse;
}

/** Persist + dispatch a command, store its result, return both id and response. */
export async function executeCommand(browserId: string, cmd: RestCommand): Promise<ExecOutcome> {
  const commandId = id("cmd");
  const tabId = cmd.target?.tabId ?? null;
  const timeoutMs = cmd.timeoutMs ?? 30_000;

  db.insert(schema.commands).values({
    id: commandId, browserId, tabId, type: cmd.type,
    payloadJson: JSON.stringify(redactSensitiveData(cmd.payload ?? {})),
    status: registry.isOnline(browserId) ? "sent" : "pending",
    createdAt: now(),
  }).run();

  const response = await sendCommand(browserId, {
    id: commandId, type: cmd.type, target: { tabId: cmd.target?.tabId, browserId }, payload: cmd.payload, timeoutMs,
  }, timeoutMs);

  // Side effect: persist screenshots returned by capture commands.
  if (response.ok && response.result && typeof response.result === "object") {
    const r = response.result as Record<string, unknown>;
    if (typeof r.dataUrl === "string" && r.dataUrl.startsWith("data:image")) {
      try {
        const stored = storeScreenshot(r.dataUrl, { browserId, tabId: tabId ?? undefined, url: r.url as string, title: r.title as string });
        (response.result as Record<string, unknown>).storedPath = stored.filePath;
        (response.result as Record<string, unknown>).screenshotId = stored.id;
      } catch (e) { log.warn("screenshot store failed", e); }
    }
  }

  db.update(schema.commands).set({
    status: response.ok ? "succeeded" : (response.error?.code === "COMMAND_TIMEOUT" ? "timeout" : "failed"),
    resultJson: response.ok ? JSON.stringify(redactSensitiveData(response.result ?? null)) : null,
    errorJson: response.ok ? null : JSON.stringify(response.error ?? null),
    completedAt: now(),
  }).where(eq(schema.commands.id, commandId)).run();

  audit(`command:${cmd.type}`, browserId, { commandId, tabId, ok: response.ok, error: response.error });
  return { commandId, response };
}
