// Service-level tests for permissions + schedules (no browser needed).
// Env set before the dynamic imports so config/db pick up a temp DB.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "bp-svc-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = `file:${join(dir, "svc.sqlite")}`;
process.env.SCREENSHOT_DIR = join(dir, "shots");

const perms = await import("./permissionsService.js");
const sched = await import("./scheduleService.js");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("permissionsService", () => {
  test("unknown domain defaults to ask", () => {
    expect(perms.getSiteMode("random.example")).toBe("ask");
    expect(perms.getSiteMode("")).toBe("ask");
  });

  test("default blocklist (incl. subdomains) wins and cannot be un-blocked via DB", () => {
    expect(perms.getSiteMode("accounts.google.com")).toBe("blocked");
    expect(perms.getSiteMode("login.accounts.google.com")).toBe("blocked"); // subdomain
    expect(perms.getSiteMode("paypal.com")).toBe("blocked");
    perms.setSitePermission({ domain: "accounts.google.com", mode: "always" }); // try to override
    expect(perms.getSiteMode("accounts.google.com")).toBe("blocked"); // still blocked
  });

  test("set / list / delete a site permission", () => {
    perms.setSitePermission({ domain: "shop.example", mode: "always" });
    expect(perms.getSiteMode("shop.example")).toBe("always");
    const listed = perms.listSitePermissions();
    expect(listed.configured.some((p) => p.domain === "shop.example" && p.mode === "always")).toBe(true);
    expect(listed.blockedByConfig).toContain("paypal.com");
    perms.deleteSitePermission("shop.example");
    expect(perms.getSiteMode("shop.example")).toBe("ask");
  });
});

describe("scheduleService", () => {
  test("create sets nextRunAt in the future and lists it", () => {
    const before = Date.now();
    const s = sched.createSchedule({ name: "nightly", browserId: "br_x", prompt: "check status", mode: "auto", intervalMinutes: 60, enabled: true });
    expect(s.nextRunAt).toBeGreaterThan(before);
    expect(s.enabled).toBe(true);
    expect(sched.listSchedules().some((r) => r.id === s.id)).toBe(true);
  });

  test("toggle enabled and delete", () => {
    const s = sched.createSchedule({ name: "hourly", browserId: "br_y", prompt: "x", mode: "read", intervalMinutes: 30, enabled: true });
    sched.setScheduleEnabled(s.id, false);
    expect(sched.listSchedules().find((r) => r.id === s.id)?.enabled).toBe(false);
    sched.deleteSchedule(s.id);
    expect(sched.listSchedules().some((r) => r.id === s.id)).toBe(false);
  });

  test("runScheduleNow marks offline when the browser isn't connected", async () => {
    const s = sched.createSchedule({ name: "off", browserId: "br_absent", prompt: "x", mode: "auto", intervalMinutes: 5, enabled: true });
    const status = await sched.runScheduleNow({ ...(sched.listSchedules().find((r) => r.id === s.id) as any), enabled: 1 });
    expect(status).toBe("offline");
  });
});
