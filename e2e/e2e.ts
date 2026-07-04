// E2E driver: real Chrome + real extension + backend + scripted model.
// Prints ✅/❌ per check; exits 1 on any failure.
const API = "http://127.0.0.1:9876";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const list = async () => (await (await fetch("http://127.0.0.1:9222/json/list")).json()) as any[];
const api = async (path: string, init?: RequestInit) =>
  (await fetch(`${API}${path}`, { headers: { "content-type": "application/json" }, ...init })).json() as Promise<any>;
const cmd = (browserId: string, type: string, payload?: unknown, tabId?: number, timeoutMs?: number) =>
  api(`/api/browsers/${browserId}/commands`, { method: "POST", body: JSON.stringify({ type, target: tabId !== undefined ? { tabId } : {}, payload, timeoutMs }) });

class Cdp {
  private ws!: WebSocket; private id = 0;
  private pending = new Map<number, (v: any) => void>();
  static async connect(url: string) {
    const c = new Cdp();
    c.ws = new WebSocket(url);
    await new Promise((res, rej) => { c.ws.onopen = res; c.ws.onerror = rej; });
    c.ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && c.pending.has(m.id)) { c.pending.get(m.id)!(m); c.pending.delete(m.id); }
    };
    return c;
  }
  send(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise<any>((res) => this.pending.set(id, res));
  }
  async eval(expr: string, userGesture = false) {
    const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception ?? r.result.exceptionDetails));
    return r.result?.result?.value;
  }
  close() { this.ws.close(); }
}

// ---------- setup: detect the unpacked extension's id, find browser, open the form page ----------
const swProbe = (await list()).find((t) => t.type === "service_worker" && t.url.includes("service-worker-loader"));
if (!swProbe) { console.error("BrowserPilot service worker not found — is Chrome running with --load-extension?"); process.exit(1); }
const EXT_ID = new URL(swProbe.url).host;
console.log("extension id:", EXT_ID);

const browsers = await api("/api/browsers");
const me = browsers.find((b: any) => b.online);
check("extension online in backend", Boolean(me), me?.id);
const BID = me.id;

const opened = await cmd(BID, "tabs.open", { url: "http://127.0.0.1:8899/form.html", active: true });
const TAB = opened.result.id as number;
check("opened form tab via REST", opened.ok, `tab ${TAB}`);
await Bun.sleep(1500);

// ---------- 1. TAB_NOT_ENABLED gate ----------
const gated = await cmd(BID, "page.extractText", {}, TAB);
check("page.extractText refused before enabling control", !gated.ok && gated.error?.code === "TAB_NOT_ENABLED", gated.error?.code);

// enable control the way the popup does (runtime message to the SW), via an extension page context
const swTarget = (await list()).find((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${EXT_ID}`));
const sw = await Cdp.connect(swTarget.webSocketDebuggerUrl);
await sw.eval(`chrome.tabs.create({ url: "chrome-extension://${EXT_ID}/src/popup/index.html", active: false }).then(t => t.id)`);
let popupTarget: any;
for (let i = 0; i < 20 && !popupTarget; i++) { await Bun.sleep(250); popupTarget = (await list()).find((t) => t.url.includes("/src/popup/index.html")); }
const popup = await Cdp.connect(popupTarget.webSocketDebuggerUrl);
const enableRes = await popup.eval(`chrome.runtime.sendMessage({ kind: "setTabEnabled", tabId: ${TAB}, enabled: true })`);
check("enabled tab control via popup message", enableRes?.ok === true, JSON.stringify(enableRes?.data));

// ---------- 2. extraction + console + screenshot on the real page ----------
const text = await cmd(BID, "page.extractText", {}, TAB);
check("extractText works after enabling", text.ok && text.result.text.includes("Search demo"));
const forms = await cmd(BID, "page.extractForms", {}, TAB);
check("extractForms sees the search form", forms.ok && JSON.stringify(forms.result).includes('"q"'));

const logs = await api(`/api/logs/console?browserId=${BID}`);
const boom = (Array.isArray(logs) ? logs : logs.events ?? []).some?.((e: any) => String(e.message).includes("boom from form page"));
check("console.error captured → backend DB", Boolean(boom));

const shot = await cmd(BID, "tabs.captureVisible", {}, TAB);
check("screenshot captured + stored", shot.ok && typeof shot.result.storedPath === "string", shot.result?.storedPath);
if (shot.ok) check("screenshot file exists on disk", await Bun.file(shot.result.storedPath).exists());

// ---------- 3. direct actions: click + type on the live DOM ----------
const typed = await cmd(BID, "page.type", { selector: "#q", text: "World" }, TAB);
check("page.type replaces value", typed.ok && typed.result.mode === "replaced");
await cmd(BID, "page.click", { selector: "#greet" }, TAB);
const out = await cmd(BID, "page.extractText", {}, TAB);
check("click ran page JS (greeting rendered, old value replaced)",
  out.ok && out.result.text.includes("Hello, World") && !out.result.text.includes("OLD VALUE"));

// ---------- 4. scripted agent, autonomous: type → Enter(submit) → wait_for → screenshot ----------
const run = await api("/api/agent/run", { method: "POST", body: JSON.stringify({ browserId: BID, tabId: TAB, prompt: "SCENARIO:search", mode: "auto" }) });
check("agent run finished", run.status === "done", run.status);
check("agent answer includes screenshot-image confirmation", String(run.answer).includes("image-seen:true"), run.answer);
const tools = (run.transcript ?? []).map((t: any) => `${t.ok ? "+" : "-"}${t.tool}`).join(" ");
console.log("   transcript:", tools);
check("all agent tools succeeded", (run.transcript ?? []).every((t: any) => t.ok), tools);
const nav = await cmd(BID, "tabs.getActive");
check("Enter really submitted the form (tab navigated to result page)",
  nav.ok && String(nav.result.url).includes("/result.html?q=hello+world"), nav.result?.url);

// history/grounding: the scripted model saw the [Current page: …] prefix
const lastReq = await (await fetch("http://127.0.0.1:9999/last")).json() as any;
check("agent run was grounded with current page url", JSON.stringify(lastReq).includes("[Current page:"));

// ---------- 5. read-only mode blocks actions server-side ----------
const ro = await api("/api/agent/run", { method: "POST", body: JSON.stringify({ browserId: BID, tabId: TAB, prompt: "SCENARIO:readonly", mode: "read" }) });
const blocked = (ro.transcript ?? []).find((t: any) => t.tool === "click");
check("read-only: click blocked server-side", ro.status === "done" && blocked && !blocked.ok && blocked.resultSummary.includes("read-only"), blocked?.resultSummary);

// ---------- 6. approve mode: pause → approve → executes ----------
// go back to the form page first
await cmd(BID, "tabs.navigate", { url: "http://127.0.0.1:8899/form.html" }, TAB);
await Bun.sleep(1200);
const ap = await api("/api/agent/run", { method: "POST", body: JSON.stringify({ browserId: BID, tabId: TAB, prompt: "SCENARIO:approve", mode: "approve" }) });
check("approve mode pauses before acting", ap.status === "awaiting_approval", ap.status);
check("pending action is the type", ap.pendingActions?.[0]?.name === "type");
const approved = await api("/api/agent/approve", { method: "POST", body: JSON.stringify({ runId: ap.runId, approve: true }) });
check("approved run completes", approved.status === "done" && approved.answer === "APPROVE DONE", approved.answer);
// prove the approved type reached the DOM: the page's own Greet button echoes #q's value
await cmd(BID, "page.click", { selector: "#greet" }, TAB);
const g1 = await cmd(BID, "page.extractText", {}, TAB);
check("approved type actually hit the field", g1.ok && g1.result.text.includes("Hello, approved text"));

// ---------- 7. approve mode: reject → nothing typed ----------
await cmd(BID, "tabs.reload", {}, TAB);
await Bun.sleep(1200);
const ap2 = await api("/api/agent/run", { method: "POST", body: JSON.stringify({ browserId: BID, tabId: TAB, prompt: "SCENARIO:approve", mode: "approve" }) });
const rejected = await api("/api/agent/approve", { method: "POST", body: JSON.stringify({ runId: ap2.runId, approve: false }) });
await cmd(BID, "page.click", { selector: "#greet" }, TAB);
const g2 = await cmd(BID, "page.extractText", {}, TAB);
check("rejected action never ran (field untouched)",
  rejected.status === "done" && g2.ok && g2.result.text.includes("Hello, OLD VALUE") && !g2.result.text.includes("approved text"));
const rejTranscript = (rejected.transcript ?? []).find((t: any) => t.tool === "type");
check("rejection recorded in transcript", rejTranscript?.resultSummary === "rejected by user");

sw.close(); popup.close();
console.log(failures === 0 ? "\nALL E2E CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
