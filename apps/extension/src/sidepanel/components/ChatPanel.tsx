import { useState, useEffect, useRef } from "react";
import { httpBaseFromWs, pageKey } from "../../shared/hooks.js";
import type { AgentMode, AgentStep, AgentAction, AgentTranscriptItem } from "@browserpilot/protocol";

interface Msg { role: "user" | "assistant"; content: string; actions?: AgentTranscriptItem[] }
type Chats = Record<string, Msg[]>;
const STORE = "browserpilot:chats";
const MODE_STORE = "browserpilot:agentMode";

const MODES: Array<[AgentMode, string, string]> = [
  ["read", "Read-only", "AI can read the page/console but never clicks or types."],
  ["approve", "Approve actions", "AI proposes each click/type; you approve before it runs."],
  ["auto", "Autonomous", "AI clicks and types on its own (only on tabs where control is enabled)."],
];

interface Pending { runId: string; assistantText: string; actions: AgentAction[]; transcript: AgentTranscriptItem[] }

export function ChatPanel({ backendUrl, browserId, tabId, pageUrl, token, prefill }: { backendUrl?: string; browserId?: string; tabId?: number; pageUrl?: string; token?: string; prefill?: string }) {
  const key = pageKey(pageUrl);
  const [chats, setChats] = useState<Chats>({});
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<AgentMode>("approve");
  const [attachShot, setAttachShot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const history = chats[key] ?? [];
  let pageLabel = "no page";
  try { const u = new URL(pageUrl!); pageLabel = u.hostname + u.pathname; } catch { if (pageUrl) pageLabel = pageUrl; }

  useEffect(() => {
    chrome.storage.local.get([STORE, MODE_STORE]).then((r) => { setChats((r[STORE] as Chats) ?? {}); if (r[MODE_STORE]) setMode(r[MODE_STORE] as AgentMode); });
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [history.length, key, pending, busy]);
  useEffect(() => { setPending(null); }, [key]); // drop a stale approval when switching page
  useEffect(() => { if (prefill) setPrompt(prefill); }, [prefill]); // "Send to AI" from the element panel

  const persist = (next: Chats) => { setChats(next); chrome.storage.local.set({ [STORE]: next }); };
  const append = (msgs: Msg[], extra: Msg[]) => persist({ ...chats, [key]: [...msgs, ...extra] });
  const newChat = () => { persist({ ...chats, [key]: [] }); setPending(null); };
  const changeMode = (m: AgentMode) => { setMode(m); chrome.storage.local.set({ [MODE_STORE]: m }); };

  const base = () => httpBaseFromWs(backendUrl!);
  const headers = (): Record<string, string> => ({ "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) });

  // Apply a backend AgentStep: either finish (push assistant msg) or surface an approval card.
  const applyStep = (step: AgentStep, priorHistory: Msg[]) => {
    if (step.status === "awaiting_approval") {
      setPending({ runId: step.runId, assistantText: step.assistantText, actions: step.pendingActions, transcript: step.transcript });
    } else if (step.status === "done") {
      append(priorHistory, [{ role: "assistant", content: step.answer, actions: step.transcript }]);
      setPending(null);
    } else {
      append(priorHistory, [{ role: "assistant", content: `⚠ ${step.error.code}: ${step.error.message}`, actions: [] }]);
      setPending(null);
    }
  };

  const ask = async () => {
    if (!prompt.trim() || !browserId || !backendUrl) { setError("Need a prompt and a connected browser."); return; }
    setError(""); setBusy(true); setPending(null);
    const withUser = [...history, { role: "user" as const, content: prompt }];
    persist({ ...chats, [key]: withUser }); setPrompt("");
    try {
      const res = await fetch(`${base()}/api/agent/run`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
          browserId, tabId, prompt, mode, attachScreenshot: attachShot,
          history: history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      applyStep(await res.json() as AgentStep, withUser);
    } catch (e) { append(withUser, [{ role: "assistant", content: `⚠ ${String(e)}` }]); }
    setBusy(false);
  };

  const resolve = async (approve: boolean) => {
    if (!pending) return;
    setBusy(true);
    const p = pending; setPending(null);
    try {
      const res = await fetch(`${base()}/api/agent/approve`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ runId: p.runId, approve }),
      });
      applyStep(await res.json() as AgentStep, history);
    } catch (e) { append(history, [{ role: "assistant", content: `⚠ ${String(e)}` }]); }
    setBusy(false);
  };

  return (
    <section>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted" title={pageUrl} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>💬 {pageLabel}</span>
        <button className="ghost" onClick={newChat} disabled={!history.length && !pending}>New chat</button>
      </div>

      <div className="row" style={{ gap: 5 }}>
        <select value={mode} onChange={(e) => changeMode(e.target.value as AgentMode)} title={MODES.find((m) => m[0] === mode)?.[2]}>
          {MODES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <label style={{ fontSize: 11, display: "flex", gap: 3, alignItems: "center" }}>
          <input type="checkbox" style={{ flex: "none" }} checked={attachShot} onChange={(e) => setAttachShot(e.target.checked)} />Screenshot
        </label>
      </div>
      <div className="muted" style={{ fontSize: 11 }}>{MODES.find((m) => m[0] === mode)?.[2]}</div>

      <div style={{ margin: "8px 0" }}>
        {history.length === 0 && !pending && <div className="muted">Ask me to read or act on this page. Each page keeps its own conversation.</div>}
        {history.map((m, i) => <MessageBox key={i} msg={m} />)}

        {pending && (
          <div style={{ border: "1px solid #e67e2288", borderLeft: "3px solid #e67e22", borderRadius: 8, padding: "8px 10px", margin: "7px 0", background: "#e67e2214" }}>
            <div className="pill" style={{ marginBottom: 4 }}>approval needed</div>
            {pending.assistantText && <div style={{ whiteSpace: "pre-wrap", marginBottom: 6 }}>{pending.assistantText}</div>}
            {pending.actions.map((a, i) => <div key={i}><code>{describeAction(a)}</code></div>)}
            <div className="row" style={{ marginTop: 6 }}>
              <button onClick={() => resolve(true)} disabled={busy}>Approve</button>
              <button className="ghost" onClick={() => resolve(false)} disabled={busy}>Reject</button>
            </div>
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
    <div style={{
      border: `1px solid ${isUser ? "#2b8cff66" : "#8884"}`, borderLeft: `3px solid ${isUser ? "#2b8cff" : "#2ecc71"}`,
      borderRadius: 8, padding: "6px 9px", margin: "7px 0", background: isUser ? "#2b8cff14" : "#8881",
    }}>
      <div className="pill" style={{ marginBottom: 4 }}>{isUser ? "you" : "assistant"}</div>
      {msg.actions && msg.actions.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          {msg.actions.map((t, i) => (
            <div key={i} className="muted" style={{ fontSize: 11 }}>{t.ok ? "✓" : "✗"} {t.tool}{t.resultSummary ? ` — ${t.resultSummary}` : ""}</div>
          ))}
        </div>
      )}
      <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
    </div>
  );
}

const describeAction = (a: AgentAction) =>
  a.name === "click" ? `🖱 click ${a.args.selector}`
  : a.name === "type" ? `⌨ type "${String(a.args.text ?? "")}" into ${a.args.selector}`
  : `${a.name} ${JSON.stringify(a.args)}`;
