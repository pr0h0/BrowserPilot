import { describe, test, expect } from "bun:test";
import type { CommandResponse } from "@browserpilot/protocol";
import { registry, type Session } from "./connectionRegistry.js";

const fakeWs = () => {
  const calls: Array<[number, string]> = [];
  return { close: (c: number, r: string) => calls.push([c, r]), calls } as any;
};
const session = (browserId: string, ws = fakeWs()): Session => ({
  browserId, name: "t", extensionVersion: "0", capabilities: [], ws, sessionId: "s", lastSeenAt: Date.now(),
});
const defer = () => {
  let resolve!: (r: CommandResponse) => void;
  const promise = new Promise<CommandResponse>((r) => (resolve = r));
  return { promise, resolve };
};

describe("pending command lifecycle", () => {
  test("times out with COMMAND_TIMEOUT when nothing resolves it", async () => {
    const d = defer();
    registry.registerPending("cmd_t1", "br_t", d.resolve, 30);
    const res = await d.promise;
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("COMMAND_TIMEOUT");
  });

  test("resolvePending delivers the response and cancels the timer", async () => {
    const d = defer();
    registry.registerPending("cmd_t2", "br_t", d.resolve, 5_000);
    expect(registry.resolvePending({ id: "cmd_t2", ok: true, result: { hi: 1 } })).toBe(true);
    const res = await d.promise;
    expect(res.ok).toBe(true);
    expect((res.result as any).hi).toBe(1);
    // second resolve for the same id is a no-op
    expect(registry.resolvePending({ id: "cmd_t2", ok: true })).toBe(false);
  });

  test("resolvePending returns false for unknown command ids", () => {
    expect(registry.resolvePending({ id: "cmd_nope", ok: true })).toBe(false);
  });

  test("failPendingForBrowser rejects only that browser's pending commands", async () => {
    const a = defer(); const b = defer();
    registry.registerPending("cmd_a", "br_A", a.resolve, 5_000);
    registry.registerPending("cmd_b", "br_B", b.resolve, 200);
    registry.failPendingForBrowser("br_A");
    const resA = await a.promise;
    expect(resA.error?.code).toBe("BROWSER_OFFLINE");
    const resB = await b.promise; // untouched → runs into its own timeout
    expect(resB.error?.code).toBe("COMMAND_TIMEOUT");
  });
});

describe("session registry", () => {
  test("add() replaces an existing connection for the same browserId and closes the old ws", () => {
    const ws1 = fakeWs(); const ws2 = fakeWs();
    registry.add(session("br_dup", ws1));
    registry.add(session("br_dup", ws2));
    expect(ws1.calls[0]?.[0]).toBe(4000);
    expect(registry.get("br_dup")?.ws).toBe(ws2);
    registry.removeByWs(ws2);
  });

  test("removeByWs fails that browser's pending commands", async () => {
    const ws = fakeWs();
    registry.add(session("br_gone", ws));
    const d = defer();
    registry.registerPending("cmd_gone", "br_gone", d.resolve, 5_000);
    expect(registry.removeByWs(ws)).toBe("br_gone");
    const res = await d.promise;
    expect(res.error?.code).toBe("BROWSER_OFFLINE");
    expect(registry.removeByWs(ws)).toBeUndefined(); // already removed
  });

  test("isOnline: fresh session online, stale (>60s) session offline, unknown offline", () => {
    const s = session("br_stale");
    registry.add(s);
    expect(registry.isOnline("br_stale")).toBe(true);
    s.lastSeenAt = Date.now() - 61_000;
    expect(registry.isOnline("br_stale")).toBe(false);
    registry.touch("br_stale");
    expect(registry.isOnline("br_stale")).toBe(true);
    registry.removeByWs(s.ws);
    expect(registry.isOnline("br_missing")).toBe(false);
  });
});
