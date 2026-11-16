// E2E driver: real Chrome + real extension + backend + scripted model.
// Prints ✅/❌ per check; exits 1 on any failure.
// Isolated test backend by default so the harness never touches a real backend on :9876
// (a developer's own browser may be connected there). Override with E2E_API / E2E_WS.
const API = process.env.E2E_API ?? "http://127.0.0.1:9887";
const WS = process.env.E2E_WS ?? "ws://127.0.0.1:9887/ws";
const TOKEN = process.env.E2E_TOKEN ?? "";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const list = async () => (await (await fetch("http://127.0.0.1:9222/json/list")).json()) as any[];
const api = async (path: string, init?: RequestInit) =>
  (await fetch(`${API}${path}`, { ...init, headers: {
    ...(init?.body != null ? { "content-type": "application/json" } : {}),
    ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    ...(init?.headers as any) } })).json() as Promise<any>;
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
// enableDebugger: the network-capture path is only reachable with it on, so exercise it here.
await popup.eval(`chrome.runtime.sendMessage({ kind: "saveSettings", settings: { backendUrl: "${WS}", pairingToken: "${TOKEN}", enableDebugger: true } })`);
const BID = await popup.eval(`chrome.storage.local.get("browserpilot:settings").then(r => r["browserpilot:settings"]?.browserId)`);
let me: any;
for (let i = 0; i < 25 && !me?.online; i++) { await Bun.sleep(1000); me = (await api("/api/browsers")).find((b: any) => b.id === BID); }
check("this test browser is online in the isolated backend", Boolean(me?.online), BID);

// The harness runs with auth on, so prove an unauthenticated caller is locked out of the same API.
{
  const bare = await fetch(`${API}/api/browsers`);
  check("REST rejects an unauthenticated caller", bare.status === 401, String(bare.status));
  const health = await fetch(`${API}/health`);
  check("/health stays public", health.status === 200, String(health.status));
  const leak = await health.json() as any;
  check("/health leaks no configuration", Object.keys(leak).sort().join(",") === "ok,service,time", Object.keys(leak).join(","));
}

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

// ---------- 11a. accessibility perception + file/drag capabilities (direct commands) ----------
{
  const li = await cmd(BID, "page.listInteractive", {}, TAB);
  const els = li.result?.elements ?? [];
  const cb = els.find((e: any) => e.selector === "#agree" || e.role === "checkbox");
  check("elements expose ARIA role (accessibility view)", els.some((e: any) => e.role), (els[0] || {}).role);
  check("checkbox exposes its role + name", Boolean(cb) && cb.role === "checkbox", JSON.stringify(cb));
  check("listInteractive returns a page outline (headings/landmarks)", Array.isArray(li.result?.outline) && li.result.outline.some((o: any) => o.role === "heading"), JSON.stringify(li.result?.outline?.slice(0, 2)));

  // download a data: URL (no network needed)
  const dl = await cmd(BID, "downloads.download", { url: "data:text/plain,browserpilot-e2e", filename: "bp-e2e.txt" }, TAB);
  check("download tool triggers a browser download", dl.ok && typeof dl.result?.downloadId === "number", JSON.stringify(dl.result || dl.error));

  // upload a real local file into the file input (CDP setFileInputFiles)
  const upPath = `${process.env.TMPDIR ?? "/tmp"}/bp-upload-e2e.txt`;
  await Bun.write(upPath, "hello upload");
  const up = await cmd(BID, "page.upload", { selector: "#file", files: [upPath] }, TAB, 15000);
  await Bun.sleep(300);
  const upOut = await cmd(BID, "page.extractText", {}, TAB);
  check("upload_file sets a file input via CDP", up.ok && upOut.ok && upOut.result.text.includes("file:bp-upload-e2e.txt"), up.ok ? upOut.result?.text?.slice(0, 60) : JSON.stringify(up.error));

  // drag the red box onto the target
  const dg = await cmd(BID, "page.drag", { from: "#drag", to: "#target" }, TAB, 15000);
  await Bun.sleep(300);
  const dgOut = await cmd(BID, "page.extractText", {}, TAB);
  check("drag moves an element from → to (trusted mouse drag)", dg.ok && dgOut.ok && dgOut.result.text.includes("dropped"), dg.ok ? dgOut.result?.text?.slice(0, 60) : JSON.stringify(dg.error));
}

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

// ---------- 12b. coordinate input on a canvas (hover → screenshot → click) ----------
{
  const cv = await cmd(BID, "tabs.open", { url: "http://127.0.0.1:8899/canvas.html", active: true });
  const CTAB = cv.result.id as number;
  await popup.eval(`chrome.runtime.sendMessage({ kind: "setTabEnabled", tabId: ${CTAB}, enabled: true })`);
  await Bun.sleep(1200);

  const cshot = await cmd(BID, "tabs.captureVisible", {}, CTAB);
  const dpr = cshot.result?.viewport?.dpr ?? 0;
  check("screenshot reports the viewport + dpr so coords have a known space", dpr > 0 && cshot.result?.imageWidth > 0,
    JSON.stringify(cshot.result?.viewport));

  // Target the dark square painted at canvas 180..220 x 130..170 — a region with no DOM node.
  // Coordinates are image pixels, so scale the CSS point we expect the page to see by dpr.
  const [cssX, cssY] = [200, 150];
  const hv = await cmd(BID, "page.hover", { x: cssX * dpr, y: cssY * dpr }, CTAB, 15000);
  await Bun.sleep(300);
  const hout = await cmd(BID, "page.extractText", {}, CTAB);
  check("hover_at moves the real pointer to the requested point (dpr-scaled)",
    hv.ok && hout.ok && hout.result.text.includes(`hover:${cssX},${cssY}`), hv.ok ? hout.result?.text?.slice(0, 40) : JSON.stringify(hv.error));

  const ck = await cmd(BID, "page.click", { x: cssX * dpr, y: cssY * dpr }, CTAB, 15000);
  await Bun.sleep(300);
  const cout = await cmd(BID, "page.extractText", {}, CTAB);
  check("click_at clicks the canvas at the exact point, trusted",
    ck.ok && cout.ok && cout.result.text.includes(`click:${cssX},${cssY} trusted:true`), ck.ok ? cout.result?.text?.slice(0, 40) : JSON.stringify(ck.error));
  check("coordinate click reports the CSS point it scaled to", ck.result?.cssPoint?.x === cssX && ck.result?.cssPoint?.y === cssY, JSON.stringify(ck.result?.cssPoint));

  const bad = await cmd(BID, "page.click", { x: "nope", y: 10 }, CTAB);
  check("coordinate click rejects non-numeric coords", !bad.ok && bad.error?.code === "INVALID_COMMAND", bad.error?.code);

  // Policy: allow the look, gate the commit — hover_at runs even in read-only, click_at does not.
  const hg = await runAgent("SCENARIO:hovergate", "read", CTAB);
  const hgHover = hg.transcript.find((t: any) => t.tool === "hover_at");
  const hgClick = hg.transcript.find((t: any) => t.tool === "click_at");
  check("read-only: hover_at is allowed", Boolean(hgHover?.ok), hgHover?.resultSummary);
  check("read-only: click_at is still blocked", Boolean(hgClick) && !hgClick.ok && /read-only/i.test(hgClick.resultSummary), hgClick?.resultSummary);
  const hgOut = await cmd(BID, "page.extractText", {}, CTAB);
  check("the gated click never reached the page (last event is still the hover)",
    hgOut.ok && hgOut.result.text.startsWith("hover:"), hgOut.result?.text?.slice(0, 40));
  await cmd(BID, "tabs.close", {}, CTAB);
}

// ---------- 12b2. iframes: list the frame tree, target any depth by frameId ----------
{
  const fr = await cmd(BID, "tabs.open", { url: "http://127.0.0.1:8899/frames.html", active: true });
  const FTAB = fr.result.id as number;
  await popup.eval(`chrome.runtime.sendMessage({ kind: "setTabEnabled", tabId: ${FTAB}, enabled: true })`);
  await Bun.sleep(1500);
  const fcmd = (type: string, payload: unknown, frameId?: number) =>
    api(`/api/browsers/${BID}/commands`, { method: "POST", body: JSON.stringify({ type, target: { tabId: FTAB, frameId }, payload }) });

  const lf = await fcmd("page.listFrames", {});
  const frames = (lf.result?.frames ?? []) as any[];
  const byDepth = (d: number) => frames.find((f) => f.url.includes(`d=${d}`));
  const f1 = byDepth(1), f2 = byDepth(2), f3 = byDepth(3);
  check("listFrames returns the full nested tree (top + 3 iframes, parent links intact)",
    lf.ok && frames.length === 4 && f1?.parentFrameId === 0 && f2?.parentFrameId === f1?.frameId && f3?.parentFrameId === f2?.frameId,
    JSON.stringify(frames.map((f) => [f.frameId, f.parentFrameId, f.url.slice(-12)])));

  // Deepest frame (cross-site from its parent): first command injects the content script there.
  await fcmd("page.type", { selector: "#q", text: "deep" }, f3?.frameId);
  const ck3 = await fcmd("page.click", { selector: "#b" }, f3?.frameId);
  const t3 = await fcmd("page.extractText", {}, f3?.frameId);
  check("type+click inside a 3-deep cross-origin iframe", ck3.ok && t3.ok && t3.result.text.includes("clicked:3:deep"), t3.result?.text ?? JSON.stringify(ck3.error));
  const t0 = await fcmd("page.extractText", {});
  check("omitting frameId still targets the top document only", t0.ok && t0.result.text.includes("level 0") && !t0.result.text.includes("clicked:"), t0.result?.text?.slice(0, 60));
  const t1 = await fcmd("page.extractText", {}, f1?.frameId);
  check("a middle frame is untouched by the deep frame's action", t1.ok && t1.result.text.includes("level 1") && !t1.result.text.includes("clicked:"), t1.result?.text?.slice(0, 60));
  const bad = await fcmd("page.extractText", {}, 99999);
  check("unknown frameId fails cleanly", !bad.ok, bad.error?.code);
  const drag = await fcmd("page.drag", { from: "#q", to: "#b" }, f1?.frameId);
  check("top-frame-only commands refuse a subframe", !drag.ok && drag.error?.code === "INVALID_COMMAND", drag.error?.code);

  const ag = await runAgent("SCENARIO:frames", "auto", FTAB);
  check("agent: list_frames → switch_frame → act inside the nested iframe", ag.status === "done" && ag.answer === "FRAMES DONE",
    JSON.stringify(ag.transcript.map((t: any) => `${t.tool}:${t.ok}`)));
  const ta = await fcmd("page.extractText", {}, f3?.frameId);
  check("agent's click landed in the deep frame", ta.ok && ta.result.text.includes("clicked:3:agent"), ta.result?.text?.slice(0, 60));
  // The real side panel on this tab: Tools shows a frame picker, and extract runs in the chosen frame.
  await popup.eval(`chrome.sidePanel.open({ windowId: ${fr.result.windowId} })`, true).catch(() => {});
  let spt: any;
  for (let i = 0; i < 20 && !spt; i++) { await Bun.sleep(250); spt = (await list()).find((t) => t.url.includes("/src/sidepanel/index.html")); }
  check("side panel opens on the iframes page", Boolean(spt));
  if (spt) {
    const sp = await Cdp.connect(spt.webSocketDebuggerUrl);
    for (let i = 0; i < 20; i++) { await Bun.sleep(250); if (await sp.eval(`!!document.querySelector('button[title="Tools"]')`)) break; }
    await sp.eval(`document.querySelector('button[title="Tools"]').click()`);
    let opts = "";
    for (let i = 0; i < 20 && !opts.includes("d=3"); i++) {
      await Bun.sleep(250);
      opts = await sp.eval(`[...document.querySelectorAll("select option")].map(o => o.value + "=" + o.textContent).join("|")`);
    }
    check("Tools lists the frame tree, nested deeper per level", opts.startsWith("0=Top document|") && /\u00a0{6}↳ [^|]*d=3/.test(opts), opts);
    await sp.eval(`(() => { const s = document.querySelector("select");
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "${f3?.frameId}");
      s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await sp.eval(`[...document.querySelectorAll("button")].find(b => b.textContent === "Extract text").click()`);
    let pre = "";
    for (let i = 0; i < 20 && !pre; i++) { await Bun.sleep(250); pre = await sp.eval(`document.querySelector("pre")?.textContent ?? ""`); }
    check("Extract text runs inside the frame picked in Tools", pre.includes("level 3") && !pre.includes("level 0"), pre.slice(0, 80));
    await sp.eval(`window.close()`).catch(() => {});
    sp.close();
  }
  await cmd(BID, "tabs.close", {}, FTAB);
}

// ---------- 12c. workflow recording: demonstrate → save → replay ----------
{
  await cmd(BID, "tabs.navigate", { url: "http://127.0.0.1:8899/form.html" }, TAB);
  await Bun.sleep(1200);
  const rec = await cmd(BID, "page.startRecorder", {}, TAB);
  check("recorder starts", rec.ok && rec.result?.recording === true, JSON.stringify(rec.result ?? rec.error));

  // Drive the page the way a human would: real trusted input, not the recorder's own API.
  await cmd(BID, "page.type", { selector: "#q", text: "recorded value" }, TAB);
  await cmd(BID, "page.click", { selector: "#greet" }, TAB);
  await Bun.sleep(400);

  const stopped = await cmd(BID, "page.stopRecorder", {}, TAB);
  const steps = stopped.result?.steps ?? [];
  check("recorder captured the typing and the click", stopped.ok && steps.some((s: any) => s.type === "page.type") && steps.some((s: any) => s.type === "page.click"),
    steps.map((s: any) => s.type).join(" "));
  check("recorded steps carry usable selectors", steps.every((s: any) => s.type === "tabs.navigate" || typeof s.payload?.selector === "string"),
    JSON.stringify(steps.slice(0, 3)));

  // Save it, then replay against a freshly reloaded page and check the effect landed.
  const saved = await api("/api/workflows", { method: "POST", body: JSON.stringify({ name: "e2e-flow", steps: steps.filter((s: any) => s.type !== "tabs.navigate") }) });
  check("workflow saved to the backend", saved.ok && saved.workflow?.id, saved.workflow?.id);

  await cmd(BID, "tabs.reload", {}, TAB); await Bun.sleep(1200);
  const replay = await api(`/api/workflows/${saved.workflow.id}/run`, { method: "POST", body: JSON.stringify({ browserId: BID, tabId: TAB }) });
  await Bun.sleep(400);
  const after = await cmd(BID, "page.extractText", {}, TAB);
  check("replaying the workflow reproduces the result", replay.ok && after.ok && after.result.text.includes("Hello, recorded value"),
    after.result?.text?.slice(0, 50));

  const listed = await api("/api/workflows");
  check("saved workflow appears in the list with a run status", listed.some((w: any) => w.id === saved.workflow.id && w.lastStatus === "ok"));
  await api(`/api/workflows/${saved.workflow.id}`, { method: "DELETE" });
}

// ---------- 12d. network tool + notification command ----------
{
  const notified = await cmd(BID, "ui.notify", { title: "E2E", message: "notification check" }, TAB);
  check("ui.notify reaches the extension", notified.ok && notified.result?.notified, JSON.stringify(notified.result ?? notified.error));

  // The toggle is enforced in the extension, so a disabled setting must swallow the command.
  await popup.eval(`chrome.runtime.sendMessage({ kind: "saveSettings", settings: { notifications: false } })`);
  const muted = await cmd(BID, "ui.notify", { title: "E2E", message: "should be suppressed" }, TAB);
  check("notifications setting off suppresses the notification", muted.ok && muted.result?.suppressed === true, JSON.stringify(muted.result));
  await popup.eval(`chrome.runtime.sendMessage({ kind: "saveSettings", settings: { notifications: true } })`);

  // Network capture needs the debugger feature enabled; without it the agent gets a clear hint.
  // Trusted input has already attached chrome.debugger to this tab; network capture must share
  // that attachment rather than attempt a second one (Chrome refuses, and used to 500 here).
  const net = await cmd(BID, "network.enable", {}, TAB);
  check("network capture enables on a tab already using trusted input", net.ok, JSON.stringify(net.result ?? net.error));
  await cmd(BID, "tabs.reload", {}, TAB); await Bun.sleep(1800);
  const recent = await cmd(BID, "network.getRecent", {}, TAB);
  check("network.getRecent returns captured requests", recent.ok && Array.isArray(recent.result?.events) && recent.result.events.length > 0,
    `${recent.result?.events?.length ?? 0} events`);
}

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

// ---------- 15b. the side panel's chat UI: approval survives a panel reopen, and stays resolved ----------
{
  await popup.eval(`chrome.storage.local.set({ "browserpilot:agentMode": "approve" })`);
  await sw.eval(`chrome.tabs.create({ url: "chrome-extension://${EXT_ID}/src/sidepanel/index.html", active: true }).then(t => t.id)`);
  let pt: any;
  for (let i = 0; i < 20 && !pt; i++) { await Bun.sleep(250); pt = (await list()).find((t) => t.url.includes("/src/sidepanel/index.html")); }
  const panel = await Cdp.connect(pt.webSocketDebuggerUrl);
  const text = () => panel.eval(`document.body.innerText`) as Promise<string>;
  const waitText = async (needle: string, ms = 8000) => {
    for (let t = 0; t < ms; t += 250) { if ((await text()).includes(needle)) return true; await Bun.sleep(250); }
    return false;
  };
  await waitText("Ask");
  await panel.eval(`(() => { const ta = document.querySelector("textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, "SCENARIO:uiapprove");
    ta.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await Bun.sleep(200);
  await panel.eval(`[...document.querySelectorAll("button")].find(b => b.textContent === "Ask").click()`);
  const asked = await waitText("approval needed");
  check("chat UI shows the approval card with a readable action", asked && (await text()).includes('⌨ type "ui approved"'), (await text()).slice(-200));

  // Close + reopen the panel (a reload is the same thing to the page): the card must come back.
  await panel.eval(`setTimeout(() => location.reload(), 0)`);
  await Bun.sleep(1500);
  check("reopened panel resumes the run and its pending approval", await waitText("approval needed"), (await text()).slice(-200));

  await panel.eval(`[...document.querySelectorAll("button")].find(b => b.textContent === "Approve").click()`);
  await Bun.sleep(1200); // run is now inside the ~3s wait_for, after the approval
  const mid = await text();
  check("approved card does not reappear while the run continues", mid.includes("working") && !mid.includes("approval needed"), mid.slice(-200));
  const done = await waitText("UI APPROVE DONE", 10000);
  const final = await text();
  check("run's answer lands in the chat exactly once", done && final.split("UI APPROVE DONE").length === 2, final.slice(-200));
  panel.close();
}

// ---------- 16. connection profiles: save several servers, switch with the popup's picker ----------
{
  const online = async () => (await api("/api/browsers")).find((b: any) => b.id === BID)?.online === true;
  await popup.eval(`chrome.runtime.sendMessage({ kind: "saveSettings", settings: { profiles: [
    { name: "nowhere", backendUrl: "ws://127.0.0.1:9/ws", pairingToken: "x" },
    { name: "e2e", backendUrl: "${WS}", pairingToken: "${TOKEN}" } ] } })`);
  await popup.eval(`setTimeout(() => location.reload(), 0)`); await Bun.sleep(1500);
  const shown = await popup.eval(`[...document.querySelectorAll("select option")].map(o => o.value).join(",") + "|" + document.querySelector("select").value`);
  check("popup lists saved profiles and marks the active one", shown === ",nowhere,e2e|e2e", shown);
  // Drive the real <select> the way a user does (React listens for a bubbling change event).
  const pick = (name: string) => popup.eval(`(() => { const s = document.querySelector("select");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "${name}");
    s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await pick("nowhere");
  let off = false; for (let i = 0; i < 10 && !off; i++) { await Bun.sleep(500); off = !(await online()); }
  const active = await popup.eval(`chrome.storage.local.get("browserpilot:settings").then(r => r["browserpilot:settings"].backendUrl)`);
  check("switching profile moves the connection to that server", off && active === "ws://127.0.0.1:9/ws", active);
  await pick("e2e");
  let on = false; for (let i = 0; i < 15 && !on; i++) { await Bun.sleep(500); on = await online(); }
  check("switching back reconnects with that profile's token", on);
}

sw.close(); popup.close();
console.log(failures === 0 ? "\nALL E2E CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
