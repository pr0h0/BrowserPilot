import { eq, lte, and } from "drizzle-orm";
import type { Schedule } from "@browserpilot/protocol";
import { db, schema } from "../db/client.js";
import { id, now } from "../util/ids.js";
import { registry } from "../ws/connectionRegistry.js";
import { agentRun, agentEvents } from "./agentService.js";
import { audit } from "./auditLogService.js";
import { log } from "../util/logger.js";

const MINUTE = 60_000;

export function listSchedules() {
  return db.select().from(schema.schedules).all().map((r) => ({ ...r, enabled: !!r.enabled }));
}

export function createSchedule(s: Schedule) {
  const row = {
    id: id("sched"), name: s.name, browserId: s.browserId, tabId: s.tabId ?? null,
    prompt: s.prompt, mode: s.mode, intervalMinutes: s.intervalMinutes, enabled: s.enabled ? 1 : 0,
    lastRunAt: null, nextRunAt: now() + s.intervalMinutes * MINUTE, lastStatus: null, createdAt: now(),
  };
  db.insert(schema.schedules).values(row).run();
  audit("schedule:create", s.browserId, { id: row.id, name: s.name, intervalMinutes: s.intervalMinutes });
  return { ...row, enabled: !!row.enabled };
}

export function deleteSchedule(scheduleId: string) {
  db.delete(schema.schedules).where(eq(schema.schedules.id, scheduleId)).run();
  return { ok: true };
}

export function setScheduleEnabled(scheduleId: string, enabled: boolean) {
  db.update(schema.schedules).set({ enabled: enabled ? 1 : 0 }).where(eq(schema.schedules.id, scheduleId)).run();
  return { ok: true };
}

/** Run one due schedule: launch a headless (no-approval, sensitive-refusing) agent run and
 *  poll it to completion, then record status. Exported for tests. */
export async function runScheduleNow(row: typeof schema.schedules.$inferSelect): Promise<string> {
  if (!registry.isOnline(row.browserId)) {
    db.update(schema.schedules).set({ lastRunAt: now(), lastStatus: "offline", nextRunAt: now() + row.intervalMinutes * MINUTE }).where(eq(schema.schedules.id, row.id)).run();
    return "offline";
  }
  const { runId } = await agentRun({
    browserId: row.browserId, tabId: row.tabId ?? undefined, prompt: row.prompt,
    mode: row.mode === "read" ? "read" : "auto", headless: true,
  });
  // poll until terminal
  const deadline = Date.now() + 3 * 60_000;
  let status = "running";
  while (Date.now() < deadline) {
    const ev = agentEvents(runId, 0);
    if (!ev) break;
    if (ev.status === "done") { status = "done"; break; }
    if (ev.status === "error") { status = "error"; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  db.update(schema.schedules).set({ lastRunAt: now(), lastStatus: status, nextRunAt: now() + row.intervalMinutes * MINUTE }).where(eq(schema.schedules.id, row.id)).run();
  audit("schedule:run", row.browserId, { id: row.id, name: row.name, status });
  return status;
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const due = db.select().from(schema.schedules)
      .where(and(eq(schema.schedules.enabled, 1), lte(schema.schedules.nextRunAt, now()))).all();
    for (const row of due) {
      try { await runScheduleNow(row); }
      catch (e) { log.warn(`schedule ${row.id} failed`, e); }
    }
  } finally { ticking = false; }
}

/** Start the 30s scheduler loop. unref so it never keeps the process alive (tests). */
export function startScheduler() {
  setInterval(() => void tick(), 30_000).unref?.();
}
