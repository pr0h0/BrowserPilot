// End-to-end backend test: real Fastify server + real WS with a fake extension on the other end.
// Env is set BEFORE the dynamic imports so config picks it up (config caches process.env at import).
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";

const dir = mkdtempSync(join(tmpdir(), "bp-test-"));
process.env.NODE_ENV = "test"; // NOT development → auth is strictly enforced
process.env.PAIRING_TOKEN = "test-secret";
process.env.DATABASE_URL = `file:${join(dir, "test.sqlite")}`;
process.env.SCREENSHOT_DIR = join(dir, "shots");
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";

const { buildApp } = await import("./app.js");
const { attachWsServer } = await import("./ws/wsServer.js");

let base = "";
let wsUrl = "";
let app: Awaited<ReturnType<typeof buildApp>>;
let wss: ReturnType<typeof attachWsServer>;

beforeAll(async () => {
  app = await buildApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  wss = attachWsServer(app.server);
  const { port } = app.server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

afterAll(async () => {
  for (const client of wss.clients) client.terminate();
  wss.close();
  app.server.closeAllConnections?.(); // kill keep-alive fetch sockets so close() can finish
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const AUTH = { authorization: "Bearer test-secret" };
const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { headers });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

/** Fake extension: connects, does the hello handshake, answers tabs.list, ignores tabs.reload,
 *  and hangs up on tabs.goBack (to exercise the disconnect-fails-pending path). */
function connectFakeExtension(browserId: string, token?: string): Promise<{ ws: WebSocket; ack: any; closed: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let ackSeen = false;
    const closed = new Promise<number>((res) => ws.on("close", (code) => res(code)));
    ws.on("open", () => ws.send(JSON.stringify({
      type: "hello", browserId, browserName: "fake", extensionVersion: "0.0.1", token, capabilities: ["tabs"],
    })));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "hello.ack") { ackSeen = true; resolve({ ws, ack: msg, closed }); return; }
      if (msg.type === "command") {
        const c = msg.command;
        if (c.type === "tabs.list") ws.send(JSON.stringify({ id: c.id, ok: true, result: { tabs: [{ id: 1, url: "https://example.com", title: "Example" }] } }));
        else if (c.type === "tabs.goBack") ws.close();
        // tabs.reload: stay silent → server-side timeout
      }
    });
    ws.on("error", (e) => { if (!ackSeen) reject(e); });
  });
}

describe("REST auth", () => {
  test("/health is open", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);
    expect((await res.json() as any).ok).toBe(true);
  });

  test("API routes reject missing and wrong tokens with 401", async () => {
    expect((await get("/api/browsers")).status).toBe(401);
    expect((await get("/api/browsers", { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await get("/api/browsers", { authorization: "test-secret" })).status).toBe(401); // not Bearer
  });

  test("API routes accept Bearer and X-Pairing-Token", async () => {
    expect((await get("/api/browsers", AUTH)).status).toBe(200);
    expect((await get("/api/browsers", { "x-pairing-token": "test-secret" })).status).toBe(200);
  });
});

describe("WS pairing", () => {
  test("wrong token → hello.ack ok:false and close 4001", async () => {
    const { ack, closed } = await connectFakeExtension("br_badtoken", "nope");
    expect(ack.ok).toBe(false);
    expect(await closed).toBe(4001);
  });

  test("missing token → rejected (not in dev mode)", async () => {
    const { ack, closed } = await connectFakeExtension("br_notoken", undefined);
    expect(ack.ok).toBe(false);
    expect(await closed).toBe(4001);
  });
});

describe("command round-trip", () => {
  test("hello → online browser → command → response → persisted", async () => {
    const ext = await connectFakeExtension("br_main", "test-secret");
    expect(ext.ack.ok).toBe(true);
    expect(ext.ack.sessionId).toStartWith("session_");

    const browsers = await (await get("/api/browsers", AUTH)).json() as any[];
    const me = browsers.find((b) => b.id === "br_main");
    expect(me.online).toBe(true);

    const res = await post("/api/browsers/br_main/commands", { type: "tabs.list" }, AUTH);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.result.tabs[0].url).toBe("https://example.com");

    // command row persisted with status succeeded
    const row = await (await get(`/api/commands/${body.commandId}`, AUTH)).json() as any;
    expect(row.status).toBe("succeeded");
    expect(row.type).toBe("tabs.list");

    ext.ws.close();
    await ext.closed;
  });

  test("no response → COMMAND_TIMEOUT and command row marked timeout", async () => {
    const ext = await connectFakeExtension("br_slow", "test-secret");
    const res = await post("/api/browsers/br_slow/commands", { type: "tabs.reload", timeoutMs: 300 }, AUTH);
    expect(res.status).toBe(502);
    const body = await res.json() as any;
    expect(body.error.code).toBe("COMMAND_TIMEOUT");
    const row = await (await get(`/api/commands/${body.commandId}`, AUTH)).json() as any;
    expect(row.status).toBe("timeout");
    ext.ws.close();
    await ext.closed;
  });

  test("disconnect while pending → BROWSER_OFFLINE", async () => {
    const ext = await connectFakeExtension("br_flaky", "test-secret");
    const res = await post("/api/browsers/br_flaky/commands", { type: "tabs.goBack", timeoutMs: 5000 }, AUTH);
    expect(res.status).toBe(502);
    expect(((await res.json()) as any).error.code).toBe("BROWSER_OFFLINE");
  });

  test("unknown browser → BROWSER_OFFLINE without waiting", async () => {
    const res = await post("/api/browsers/br_ghost/commands", { type: "tabs.list" }, AUTH);
    expect(res.status).toBe(502);
    expect(((await res.json()) as any).error.code).toBe("BROWSER_OFFLINE");
  });

  test("invalid command type is rejected with 400 before dispatch", async () => {
    const res = await post("/api/browsers/br_main/commands", { type: "shell.exec", payload: { cmd: "rm -rf /" } }, AUTH);
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("INVALID_COMMAND");
  });

  test("sensitive payload fields are redacted in the persisted command", async () => {
    const ext = await connectFakeExtension("br_redact", "test-secret");
    const res = await post("/api/browsers/br_redact/commands",
      { type: "tabs.list", payload: { note: "x", password: "hunter2" } }, AUTH);
    const body = await res.json() as any;
    const row = await (await get(`/api/commands/${body.commandId}`, AUTH)).json() as any;
    expect(JSON.stringify(row.payload)).toContain("[REDACTED]");
    expect(JSON.stringify(row.payload)).not.toContain("hunter2");
    ext.ws.close();
    await ext.closed;
  });
});

describe("workflows and chat", () => {
  test("workflow executes steps sequentially and returns a timeline", async () => {
    const ext = await connectFakeExtension("br_wf", "test-secret");
    const res = await post("/api/workflows/run", {
      browserId: "br_wf", name: "smoke", steps: [{ type: "tabs.list" }, { type: "tabs.list" }],
    }, AUTH);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    ext.ws.close();
    await ext.closed;
  });

  test("workflow with unknown step type → 400", async () => {
    const res = await post("/api/workflows/run", { browserId: "b", name: "bad", steps: [{ type: "eval" }] }, AUTH);
    expect(res.status).toBe(400);
  });

  test("chat without AI configured → 503 AI_NOT_CONFIGURED", async () => {
    const res = await post("/api/chat", { browserId: "br_main", prompt: "hi" }, AUTH);
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error.code).toBe("AI_NOT_CONFIGURED");
  });
});
