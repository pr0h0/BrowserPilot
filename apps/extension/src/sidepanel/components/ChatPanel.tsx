import { useState, useEffect, useRef } from "react";
import { pageKey } from "../../shared/hooks.js";
import { makeApi } from "../../shared/api.js";
import type { AgentMode, AgentAction, AgentTranscriptItem, AgentEvent, AgentEventsResponse } from "@browserpilot/protocol";

interface Msg { role: "user" | "assistant"; content: string; actions?: AgentTranscriptItem[] }
type Chats = Record<string, Msg[]>;
const STORE = "browserpilot:chats";
const MODE_STORE = "browserpilot:agentMode";

const MODES: Array<[AgentMode, string, string]> = [
  ["read", "Read-only", "Reads the page/console but never clicks or types."],
  ["approve", "Approve actions", "Proposes each action; you approve before it runs (auto-runs on trusted sites)."],
  ["auto", "Autonomous", "Acts on its own — sensitive actions still ask; blocked sites are refused."],
];

interface Live { runId: string; steps: AgentTranscriptItem[]; assistantText: string;
  pending?: { actions: AgentAction[] }; status: string }

export function ChatPanel({ backendUrl, browserId, tabId, pageUrl, token, prefill }:
  { backendUrl?: string; browserId?: string; tabId?: number; pageUrl?: string; token?: string; prefill?: string }) {
  const key = pageKey(pageUrl);
  const [chats, setChats] = useState<Chats>({});
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<AgentMode>("approve");
  const [attachShot, setAttachShot] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const api = makeApi(backendUrl, token);

  const history = chats[key] ?? [];
  let pageLabel = "no page";
  try { const u = new URL(pageUrl!); pageLabel = u.hostname + u.pathname; } catch { if (pageUrl) pageLabel = pageUrl; }

  useEffect(() => {
    chrome.storage.local.get([STORE, MODE_STORE]).then((r) => { setChats((r[STORE] as Chats) ?? {}); if (r[MODE_STORE]) setMode(r[MODE_STORE] as AgentMode); });
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [history.length, key, live]);
  useEffect(() => { setLive(null); }, [key]);
  useEffect(() => { if (prefill) setPrompt(prefill); }, [prefill]);

  const persist = (next: Chats) => { setChats(next); chrome.storage.local.set({ [STORE]: next }); };
  const append = (msgs: Msg[], extra: Msg[]) => persist({ ...chats, [key]: [...msgs, ...extra] });
  const newChat = () => { persist({ ...chats, [key]: [] }); setLive(null); };
  const changeMode = (m: AgentMode) => { setMode(m); chrome.storage.local.set({ [MODE_STORE]: m }); };

  // Poll the backend event stream for a run until it finishes / needs approval.
  const pollRun = async (runId: string, priorHistory: Msg[]) => {
    let since = 0;
    let cur: Live = { runId, steps: [], assistantText: "", status: "running" };
    setLive(cur);
    while (true) {
      let ev: AgentEventsResponse;
      try { ev = await api.get(`/api/agent/events?runId=${runId}&since=${since}`); }
      catch (e) { append(priorHistory, [{ role: "assistant", content: `⚠ ${String(e)}` }]); setLive(null); return; }
      since = ev.cursor;
      for (const e of ev.events as AgentEvent[]) {
        if (e.type === "tool") cur = { ...cur, steps: [...cur.steps, { tool: e.tool, args: e.args, ok: e.ok, resultSummary: e.resultSummary }] };
        else if (e.type === "assistant" && e.text) cur = { ...cur, assistantText: e.text };
        else if (e.type === "awaiting_approval") cur = { ...cur, assistantText: e.assistantText || cur.assistantText, pending: { actions: e.pendingActions } };
        else if (e.type === "done") { append(priorHistory, [{ role: "assistant", content: e.answer, actions: cur.steps }]); setLive(null); return; }
        else if (e.type === "error") { append(priorHistory, [{ role: "assistant", content: `⚠ ${e.code}: ${e.message}`, actions: cur.steps }]); setLive(null); return; }
      }
      cur = { ...cur, status: ev.status };
      setLive({ ...cur });
      if (ev.status === "awaiting_approval") return; // wait for the user
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  const ask = async () => {
    if (!prompt.trim() || !browserId || !api.ok) { setError("Need a prompt and a connected browser."); return; }
    setError("");
    const withUser = [...history, { role: "user" as const, content: prompt }];
    persist({ ...chats, [key]: withUser }); setPrompt("");
    try {
      const res = await api.post("/api/agent/run", { browserId, tabId, prompt, mode, attachScreenshot: attachShot,
        history: history.slice(-12).map((m) => ({ role: m.role, content: m.content })) });
      await pollRun(res.runId, withUser);
    } catch (e) { append(withUser, [{ role: "assistant", content: `⚠ ${String(e)}` }]); }
  };

  const resolve = async (approve: boolean) => {
    if (!live) return;
    try { await api.post("/api/agent/approve", { runId: live.runId, approve }); await pollRun(live.runId, history); }
    catch (e) { append(history, [{ role: "assistant", content: `⚠ ${String(e)}` }]); setLive(null); }
  };

  const stop = async () => { if (live) { try { await api.post("/api/agent/stop", { runId: live.runId }); } catch {} } };

  const busy = live !== null && live.status === "running";

  return (
    <section className="pad">
      <div className="row between">
        <span className="muted ellipsis" title={pageUrl}>💬 {pageLabel}</span>
        <button className="ghost sm" onClick={newChat} disabled={!history.length && !live}>New chat</button>
      </div>

      <div className="row" style={{ gap: 6 }}>
        <select value={mode} onChange={(e) => changeMode(e.target.value as AgentMode)} title={MODES.find((m) => m[0] === mode)?.[2]}>
          {MODES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={attachShot} onChange={(e) => setAttachShot(e.target.checked)} />Screenshot</label>
      </div>
      <div className="muted tiny">{MODES.find((m) => m[0] === mode)?.[2]}</div>

      <div className="chatlog">
        {history.length === 0 && !live && <div className="muted">Ask me to read or act on this page. Each page keeps its own conversation.</div>}
        {history.map((m, i) => <MessageBox key={i} msg={m} />)}

        {live && (
          <div className="card live">
            <div className="row between">
              <span className="pill">{live.pending ? "approval needed" : busy ? "working…" : live.status}</span>
              {busy && <button className="ghost sm danger" onClick={stop}>Stop</button>}
            </div>
            {live.steps.map((t, i) => (
              <div key={i} className="muted tiny">{t.ok ? "✓" : "✗"} {t.tool}{t.resultSummary ? ` — ${t.resultSummary}` : ""}</div>
            ))}
            {live.assistantText && <div className="prewrap" style={{ marginTop: 4 }}>{live.assistantText}</div>}
            {live.pending && (
              <div style={{ marginTop: 6 }}>
                {live.pending.actions.map((a, i) => <div key={i}><code>{describeAction(a)}</code></div>)}
                <div className="row" style={{ marginTop: 6 }}>
                  <button onClick={() => resolve(true)}>Approve</button>
                  <button className="ghost" onClick={() => resolve(false)}>Reject</button>
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(); }}
        placeholder='e.g. "click the red Buy button"   (Ctrl/⌘+Enter to send)' />
      <div className="row"><button onClick={ask} disabled={busy}>{busy ? "Working…" : "Ask"}</button></div>
      {error && <div className="muted err">{error}</div>}
    </section>
  );
}

function MessageBox({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`card msg ${isUser ? "user" : "assistant"}`}>
      <div className="pill">{isUser ? "you" : "assistant"}</div>
      {msg.actions && msg.actions.length > 0 && (
        <div style={{ margin: "4px 0" }}>
          {msg.actions.map((t, i) => <div key={i} className="muted tiny">{t.ok ? "✓" : "✗"} {t.tool}{t.resultSummary ? ` — ${t.resultSummary}` : ""}</div>)}
        </div>
      )}
      <div className="prewrap">{msg.content}</div>
    </div>
  );
}

const describeAction = (a: AgentAction) =>
  a.name === "click" ? `🖱 click ${a.args.selector}`
  : a.name === "type" ? `⌨ type "${String(a.args.text ?? "")}" into ${a.args.selector}`
  : a.name === "navigate" ? `🧭 navigate ${a.args.url}`
  : `${a.name} ${JSON.stringify(a.args)}`;
