import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { db, schema } from "../db/client.js";
import { config } from "../config.js";
import { id, now } from "../util/ids.js";

mkdirSync(resolve(config.screenshotDir), { recursive: true });

interface ShotMeta { browserId: string; tabId?: number; url?: string; title?: string }

/** Persist a captured screenshot dataUrl to disk + DB. Returns the stored file path. */
export function storeScreenshot(dataUrl: string, meta: ShotMeta) {
  const m = /^data:(image\/\w+);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw new Error("invalid screenshot dataUrl");
  const [, mimeType, b64] = m;
  const shotId = id("shot");
  const filePath = join(resolve(config.screenshotDir), `${shotId}.png`);
  writeFileSync(filePath, Buffer.from(b64, "base64"));
  db.insert(schema.screenshots).values({
    id: shotId, browserId: meta.browserId, tabId: meta.tabId ?? null,
    url: meta.url ?? null, title: meta.title ?? null, filePath, mimeType, createdAt: now(),
  }).run();
  return { id: shotId, filePath, mimeType };
}
