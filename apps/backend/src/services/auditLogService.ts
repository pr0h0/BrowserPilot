import { db, schema } from "../db/client.js";
import { id, now } from "../util/ids.js";
import { redactSensitiveData } from "../util/redaction.js";

export function audit(action: string, browserId: string | null, details?: unknown) {
  db.insert(schema.auditLogs).values({
    id: id("audit"),
    browserId,
    action,
    detailsJson: JSON.stringify(redactSensitiveData(details ?? {})),
    createdAt: now(),
  }).run();
}
