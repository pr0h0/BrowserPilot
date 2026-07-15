// E2E driver: real Chrome + real extension + backend + scripted model.
// Prints ✅/❌ per check; exits 1 on any failure.
// Isolated test backend by default so the harness never touches a real backend on :9876
// (a developer's own browser may be connected there). Override with E2E_API / E2E_WS.
const API = process.env.E2E_API ?? "http://127.0.0.1:9887";
const WS = process.env.E2E_WS ?? "ws://127.0.0.1:9887/ws";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const list = async () => (await (await fetch("http://127.0.0.1:9222/json/list")).json()) as any[];
const api = async (path: string, init?: RequestInit) =>
  (await fetch(`${API}${path}`, { ...init, headers: { ...(init?.body != null ? { "content-type": "application/json" } : {}), ...(init?.headers as any) } })).json() as Promise<any>;
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

// Open the popup once (SW → tabs.create); settings changes must come from a page context —
// chrome.runtime.sendMessage from the SW to itself has no receiver.
const sw = await Cdp.connect(swProbe.webSocketDebuggerUrl);
await sw.eval(`chrome.tabs.create({ url: "chrome-extension://${EXT_ID}/src/popup/index.html", active: false }).then(t => t.id)`);
let popupTarget: any;
for (let i = 0; i < 20 && !popupTarget; i++) { await Bun.sleep(250); popupTarget = (await list()).find((t) => t.url.includes("/src/popup/index.html")); }
const popup = await Cdp.connect(popupTarget.webSocketDebuggerUrl);
for (let i = 0; i < 20; i++) { await Bun.sleep(200); if (await popup.eval(`!!chrome?.runtime`)) break; }

// Point THIS test Chrome at the isolated test backend and read its own browserId — the backend
// may have other browsers connected (a developer's real browser), so never use find(online).
await popup.eval(`chrome.runtime.sendMessage({ kind: "saveSettings", settings: { backendUrl: "${WS}" } })`);
const BID = await popup.eval(`chrome.storage.local.get("browserpilot:settings").then(r => r["browserpilot:settings"]?.browserId)`);
let me: any;
for (let i = 0; i < 25 && !me?.online; i++) { await Bun.sleep(1000); me = (await api("/api/browsers")).find((b: any) => b.id === BID); }
check("this test browser is online in the isolated backend", Boolean(me?.online), BID);

// Clean slate: drop any leftover permission for the test host so reruns are idempotent.
await api("/api/permissions/127.0.0.1", { method: "DELETE" }).catch(() => {});

const opened = await cmd(BID, "tabs.open", { url: "http://127.0.0.1:8899/form.html", active: true });
const TAB = opened.result.id as number;
check("opened form tab via REST", opened.ok, `tab ${TAB}`);
await Bun.sleep(1500);

// ---------- 1. TAB_NOT_ENABLED gate ----------
const gated = await cmd(BID, "page.extractText", {}, TAB);
check("page.extractText refused before enabling control", !gated.ok && gated.error?.code === "TAB_NOT_ENABLED", gated.error?.code);

// enable control the way the popup does (runtime message to the SW), reusing the setup popup
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

// ---------- async agent helpers (poll the streamed event log to completion) ----------
interface AgentResult { runId: string; status: string; answer: string; pendingActions: any[]; transcript: any[]; toolEvents: number; cursor: number }
async function poll(runId: string, since = 0, seed?: Partial<AgentResult>): Promise<AgentResult> {
  const r: AgentResult = { runId, status: "running", answer: "", pendingActions: [], transcript: [], toolEvents: 0, cursor: since, ...seed };
  for (let i = 0; i < 240; i++) { // ~120s ceiling
    const ev = await api(`/api/agent/events?runId=${runId}&since=${r.cursor}`);
    r.cursor = ev.cursor; r.status = ev.status; r.transcript = ev.transcript ?? r.transcript;
    for (const e of ev.events ?? []) {
      if (e.type === "tool") r.toolEvents++;
      if (e.type === "done") r.answer = e.answer;
      if (e.type === "awaiting_approval") r.pendingActions = e.pendingActions ?? [];
      if (e.type === "error") { r.answer = `${e.code}: ${e.message}`; }
    }
    if (ev.status !== "running") return r;
    await Bun.sleep(400);
  }
  return r;
}
const startAgent = async (prompt: string, mode: string, tabId = TAB) =>
  (await api("/api/agent/run", { method: "POST", body: JSON.stringify({ browserId: BID, tabId, prompt, mode }) })).runId as string;
const runAgent = async (prompt: string, mode: string, tabId = TAB) => poll(await startAgent(prompt, mode, tabId));

// ---------- 4. scripted agent, autonomous: type → Enter → wait_for → screenshot ----------
const run = await runAgent("SCENARIO:search", "auto");
check("agent run finished", run.status === "done", run.status);
check("agent answer includes screenshot-image confirmation", String(run.answer).includes("image-seen:true"), run.answer);
const tools = run.transcript.map((t: any) => `${t.ok ? "+" : "-"}${t.tool}`).join(" ");
console.log("   transcript:", tools);
check("all agent tools succeeded", run.transcript.every((t: any) => t.ok), tools);
const nav = await cmd(BID, "tabs.getActive");
check("Enter really submitted the form (tab navigated to result page)",
  nav.ok && String(nav.result.url).includes("/result.html?q=hello+world"), nav.result?.url);
const lastReq = await (await fetch(`${process.env.E2E_SAI ?? "http://127.0.0.1:9999"}/last`)).json() as any;
check("agent run grounded with current page", JSON.stringify(lastReq).includes("[Current page"));

// ---------- 5. read-only mode blocks actions server-side ----------
const ro = await runAgent("SCENARIO:readonly", "read");
const roClick = ro.transcript.find((t: any) => t.tool === "click");
check("read-only: click blocked server-side", ro.status === "done" && roClick && !roClick.ok && /read-only/i.test(roClick.resultSummary), roClick?.resultSummary);

// ---------- 6. approve mode: pause → approve → executes ----------
await cmd(BID, "tabs.navigate", { url: "http://127.0.0.1:8899/form.html" }, TAB);
await Bun.sleep(1200);
const ap = await runAgent("SCENARIO:approve", "approve");
check("approve mode pauses before acting", ap.status === "awaiting_approval", ap.status);
check("pending action is the type", ap.pendingActions?.[0]?.name === "type");
const approved = await poll(ap.runId, ap.cursor,
  { ...(await api("/api/agent/approve", { method: "POST", body: JSON.stringify({ runId: ap.runId, approve: true }) })) });
check("approved run completes", approved.status === "done" && approved.answer === "APPROVE DONE", approved.answer);
await cmd(BID, "page.click", { selector: "#greet" }, TAB);
const g1 = await cmd(BID, "page.extractText", {}, TAB);
check("approved type actually hit the field", g1.ok && g1.result.text.includes("Hello, approved text"));

// ---------- 7. approve mode: reject → nothing typed ----------
await cmd(BID, "tabs.reload", {}, TAB);
await Bun.sleep(1200);
const ap2 = await runAgent("SCENARIO:approve", "approve");
await api("/api/agent/approve", { method: "POST", body: JSON.stringify({ runId: ap2.runId, approve: false }) });
const rejected = await poll(ap2.runId, ap2.cursor);
await cmd(BID, "page.click", { selector: "#greet" }, TAB);
const g2 = await cmd(BID, "page.extractText", {}, TAB);
check("rejected action never ran (field untouched)",
  rejected.status === "done" && g2.ok && g2.result.text.includes("Hello, OLD VALUE") && !g2.result.text.includes("approved text"));
check("rejection recorded in transcript", rejected.transcript.find((t: any) => t.tool === "type")?.resultSummary === "rejected by user");

// ---------- 8. live streaming + stop button ----------
await cmd(BID, "tabs.reload", {}, TAB); await Bun.sleep(1000);
const loopId = await startAgent("SCENARIO:loop", "auto");
let cur = 0, streamed = 0;
for (let i = 0; i < 3; i++) { await Bun.sleep(500); const ev = await api(`/api/agent/events?runId=${loopId}&since=${cur}`); cur = ev.cursor; streamed += (ev.events ?? []).filter((e: any) => e.type === "tool").length; }
check("events stream incrementally while running", streamed >= 2, `${streamed} tool events observed mid-run`);
await api("/api/agent/stop", { method: "POST", body: JSON.stringify({ runId: loopId }) });
const stopped = await poll(loopId, cur);
check("stop button ends the run", stopped.status === "done" && stopped.answer.includes("Stopped by user"), stopped.answer);

// ---------- 8b. steering: inject a message mid-run to redirect it ----------
await cmd(BID, "tabs.reload", {}, TAB); await Bun.sleep(900);
const steerId = await startAgent("SCENARIO:steer", "auto");
let sc = 0;
for (let i = 0; i < 3; i++) { await Bun.sleep(500); const ev = await api(`/api/agent/events?runId=${steerId}&since=${sc}`); sc = ev.cursor; }
const evMid = await api(`/api/agent/events?runId=${steerId}&since=0`);
check("steer: run is still active before steering", evMid.status === "running", evMid.status);
const steerRes = await api("/api/agent/steer", { method: "POST", body: JSON.stringify({ runId: steerId, text: "STEERNOW wrap it up" }) });
check("steer accepted by an active run", steerRes.ok === true, JSON.stringify(steerRes));
const steered = await poll(steerId, sc);
check("steering redirects the run mid-flight", steered.status === "done" && steered.answer.includes("STEERED") && steered.answer.includes("STEERNOW"), steered.answer);
const steerDead = await api("/api/agent/steer", { method: "POST", body: JSON.stringify({ runId: steerId, text: "STEERNOW too late" }) });
check("steer rejected after the run ends", steerDead.ok === false, JSON.stringify(steerDead));

// ---------- 9. sensitive-action floor: auto mode still pauses for a "Delete account" click ----------
const sens = await runAgent("SCENARIO:sensitive", "auto");
check("sensitive action forces approval even in autonomous mode", sens.status === "awaiting_approval", sens.status);
check("pending sensitive action is the delete click", sens.pendingActions?.[0]?.args?.selector === "#danger");
const sensDone = await poll(sens.runId, sens.cursor,
  { ...(await api("/api/agent/approve", { method: "POST", body: JSON.stringify({ runId: sens.runId, approve: true }) })) });
check("approved sensitive action completes", sensDone.status === "done" && sensDone.answer === "SENSITIVE DONE", sensDone.answer);

// ---------- 10. per-site permission: blocked domain refuses actions ----------
await api("/api/permissions", { method: "POST", body: JSON.stringify({ domain: "127.0.0.1", mode: "blocked" }) });
const blk = await runAgent("SCENARIO:blocked", "auto");
const blkClick = blk.transcript.find((t: any) => t.tool === "click");
check("action on a blocked site is refused server-side", blk.status === "done" && blkClick && !blkClick.ok && blkClick.resultSummary.includes("Blocked"), blkClick?.resultSummary);
const delRes = await api("/api/permissions/127.0.0.1", { method: "DELETE" }); // unblock for the next test
const permList = await api("/api/permissions");
check("permission cleared after delete", !(permList.configured ?? []).some((p: any) => p.domain === "127.0.0.1"), JSON.stringify(delRes));

// ---------- 11. multi-tab: list_tabs + switch_tab ----------
await cmd(BID, "tabs.open", { url: "http://127.0.0.1:8899/result.html?q=second", active: false });
await Bun.sleep(800);
const mt = await runAgent("SCENARIO:multitab", "auto");
const switched = mt.transcript.find((t: any) => t.tool === "switch_tab");
check("agent can switch between tabs", mt.status === "done" && switched?.ok && switched.resultSummary.includes("switched to tab"), switched?.resultSummary);

// ---------- 11b. find tool + auto-attached page state after actions ----------
await cmd(BID, "tabs.reload", {}, TAB); await Bun.sleep(900);
const fnd = await runAgent("SCENARIO:find", "auto");
const fndTools = fnd.transcript.map((t: any) => t.tool);
check("agent used find() to locate the element", fndTools.includes("find"), fndTools.join(" "));
check("find→click succeeded and click result auto-included the updated page", fnd.status === "done" && fnd.answer.includes("page-attached:true"), fnd.answer);

// ---------- 12. CDP trusted input (real isTrusted events) ----------
const tclick = await cmd(BID, "page.click", { selector: "#greet" }, TAB);
check("click uses CDP trusted input (isTrusted)", tclick.ok && tclick.result?.trusted === true, JSON.stringify(tclick.result));
const ttype = await cmd(BID, "page.type", { selector: "#q", text: "trusted" }, TAB);
check("type uses CDP trusted input", ttype.ok && ttype.result?.trusted === true, JSON.stringify(ttype.result));
await cmd(BID, "page.click", { selector: "#greet" }, TAB);
const tout = await cmd(BID, "page.extractText", {}, TAB);
check("trusted type actually landed in the field", tout.ok && tout.result.text.includes("Hello, trusted"));

// ---------- 13. form_input: checkbox + select via set_field ----------
await cmd(BID, "tabs.reload", {}, TAB); await Bun.sleep(1000);
const form = await runAgent("SCENARIO:form", "auto");
check("form_input agent run completes", form.status === "done" && form.answer === "FORM DONE", form.answer);
// the page's onchange handlers reflect the new state into #out — read it back via extractText
const fout = await cmd(BID, "page.extractText", {}, TAB);
check("set_field checked the checkbox (change event fired)", fout.ok && fout.result.text.includes("agree=true"), fout.result?.text);
check("set_field picked the <select> option by visible text", fout.ok && fout.result.text.includes("color=blue"), fout.result?.text);

// ---------- 14. model override + token usage ----------
const mrun = await api("/api/agent/run", { method: "POST", body: JSON.stringify({ browserId: BID, tabId: TAB, prompt: "SCENARIO:readonly", mode: "read", model: "custom-model-xyz" }) });
const mres = await poll(mrun.runId);
const mev = await api(`/api/agent/events?runId=${mrun.runId}&since=0`);
check("model override is applied to the run", mev.model === "custom-model-xyz", mev.model);
check("token usage is accounted", (mev.usage?.totalTokens ?? 0) > 0, JSON.stringify(mev.usage));
const lastAi = await (await fetch(`${process.env.E2E_SAI ?? "http://127.0.0.1:9999"}/last`)).json() as any;
check("override model reached the provider request", lastAi.model === "custom-model-xyz", lastAi.model);
void mres;

// ---------- 15. scheduling + activity endpoints ----------
const sched = await api("/api/schedules", { method: "POST", body: JSON.stringify({ name: "e2e", browserId: BID, prompt: "SCENARIO:readonly", mode: "read", intervalMinutes: 60 }) });
check("schedule created", sched.ok && sched.schedule?.id, sched.schedule?.id);
const schedules = await api("/api/schedules");
check("schedule appears in list", schedules.some((s: any) => s.id === sched.schedule.id));
await api(`/api/schedules/${sched.schedule.id}`, { method: "DELETE" });
const activity = await api(`/api/activity?browserId=${BID}`);
check("activity feed records agent runs", (activity.items ?? []).some((it: any) => it.action === "agent:run"));

sw.close(); popup.close();
console.log(failures === 0 ? "\nALL E2E CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
