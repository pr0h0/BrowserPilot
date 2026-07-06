import { useState, useEffect, useRef } from "react";
import { makeApi } from "../../shared/api.js";
import { Markdown } from "./Markdown.js";
import type { AgentMode, AgentAction, AgentTranscriptItem, AgentEvent, AgentEventsResponse } from "@browserpilot/protocol";

interface Msg { role: "user" | "assistant"; content: string; actions?: AgentTranscriptItem[]; tokens?: number }
interface SavedPrompt { name: string; text: string }
const PROMPTS = "browserpilot:prompts";
interface Session { id: string; title: string; createdAt: number; updatedAt: number; messages: Msg[] }
type Sessions = Record<string, Session>;

const SESS = "browserpilot:sessions";
const CUR = "browserpilot:currentSession";
const OLD = "browserpilot:chats"; // legacy page-keyed chats, migrated once
const MODE_STORE = "browserpilot:agentMode";
const NEW_TITLE = "New chat";

const newId = () => `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const blankSession = (): Session => ({ id: newId(), title: NEW_TITLE, createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
const titleFrom = (msgs: Msg[]) => msgs.find((m) => m.role === "user")?.content.trim().slice(0, 44) ?? "";
const timeAgo = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

const MODES: Array<[AgentMode, string, string]> = [
  ["read", "Read-only", "Reads the page/console but never clicks or types."],
  ["approve", "Approve actions", "Proposes each action; you approve before it runs (auto-runs on trusted sites)."],
  ["auto", "Autonomous", "Acts on its own — sensitive actions still ask; blocked sites are refused."],
];

interface Live { runId: string; steps: AgentTranscriptItem[]; assistantText: string;
  pending?: { actions: AgentAction[] }; status: string; tokens: number }

export function ChatPanel({ backendUrl, browserId, tabId, pageUrl, token, prefill, maxSteps, model }:
  { backendUrl?: string; browserId?: string; tabId?: number; pageUrl?: string; token?: string; prefill?: string; maxSteps?: number; model?: string }) {
  const [sessions, setSessions] = useState<Sessions>({});
  const [currentId, setCurrentId] = useState<string>("");
  const [showList, setShowList] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<AgentMode>("approve");
  const [attachShot, setAttachShot] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const api = makeApi(backendUrl, token);

  const current = sessions[currentId];
  const history = current?.messages ?? [];
  let pageLabel = "no page";
  try { const u = new URL(pageUrl!); pageLabel = u.hostname + u.pathname; } catch { if (pageUrl) pageLabel = pageUrl; }

  // Load sessions once. Sessions are global — NOT tied to page/domain — and persist across pages.
  useEffect(() => {
    chrome.storage.local.get([SESS, CUR, OLD, MODE_STORE, PROMPTS]).then((r) => {
      if (r[MODE_STORE]) setMode(r[MODE_STORE] as AgentMode);
      if (Array.isArray(r[PROMPTS])) setPrompts(r[PROMPTS] as SavedPrompt[]);
      const sess: Sessions = { ...(r[SESS] as Sessions) };
      // One-time migration: fold legacy page-keyed chats into standalone sessions.
      if (Object.keys(sess).length === 0 && r[OLD]) {
        for (const msgs of Object.values(r[OLD] as Record<string, Msg[]>)) {
          if (!msgs?.length) continue;
          const s = { ...blankSession(), title: titleFrom(msgs) || NEW_TITLE, messages: msgs };
          sess[s.id] = s;
        }
      }
      let cur = r[CUR] as string | undefined;
      if (!cur || !sess[cur]) {
        const ids = Object.keys(sess).sort((a, b) => sess[b].updatedAt - sess[a].updatedAt);
        if (ids.length) cur = ids[0];
        else { const s = blankSession(); sess[s.id] = s; cur = s.id; }
      }
      setSessions(sess); setCurrentId(cur);
      chrome.storage.local.set({ [SESS]: sess, [CUR]: cur });
    });
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [history.length, currentId, live]);
  useEffect(() => { if (prefill) setPrompt(prefill); }, [prefill]);

  const saveSessions = (next: Sessions, cur = currentId) => { setSessions(next); chrome.storage.local.set({ [SESS]: next, [CUR]: cur }); };
  const changeMode = (m: AgentMode) => { setMode(m); chrome.storage.local.set({ [MODE_STORE]: m }); };

  const persistPrompts = (next: SavedPrompt[]) => { setPrompts(next); chrome.storage.local.set({ [PROMPTS]: next }); };
  const saveCurrentPrompt = () => {
    const text = prompt.trim(); if (!text) return;
    const name = (window.prompt("Save this as a shortcut named:", text.slice(0, 24)) ?? "").trim();
    if (!name) return;
    persistPrompts([...prompts.filter((p) => p.name !== name), { name, text }]);
  };
  const deletePrompt = (name: string) => persistPrompts(prompts.filter((p) => p.name !== name));
  // "/" at the start of the box opens the saved-prompt picker, filtered by what follows.
  const slash = prompt.startsWith("/") ? prompt.slice(1).toLowerCase() : null;
  const slashMatches = slash !== null ? prompts.filter((p) => p.name.toLowerCase().includes(slash)) : [];

  // Replace the current session's messages (titles auto-derive from the first user turn).
  const setMessages = (msgs: Msg[]) => {
    const s = sessions[currentId]; if (!s) return;
    const title = s.title === NEW_TITLE ? (titleFrom(msgs) || NEW_TITLE) : s.title;
    saveSessions({ ...sessions, [currentId]: { ...s, messages: msgs, title, updatedAt: Date.now() } });
  };
  const append = (prior: Msg[], extra: Msg[]) => setMessages([...prior, ...extra]);

  const newChat = () => { const s = blankSession(); saveSessions({ ...sessions, [s.id]: s }, s.id); setCurrentId(s.id); setLive(null); setShowList(false); setPrompt(""); };
  const openSession = (id: string) => { setCurrentId(id); chrome.storage.local.set({ [CUR]: id }); setLive(null); setShowList(false); };
  const deleteSession = (id: string) => {
    const next = { ...sessions }; delete next[id];
    let cur = currentId;
    if (id === currentId) {
      const ids = Object.keys(next).sort((a, b) => next[b].updatedAt - next[a].updatedAt);
      if (ids.length) cur = ids[0];
      else { const s = blankSession(); next[s.id] = s; cur = s.id; }
      setCurrentId(cur); setLive(null);
    }
    saveSessions(next, cur);
  };

  // Poll the backend event stream for a run until it finishes / needs approval.
  const pollRun = async (runId: string, priorHistory: Msg[]) => {
    let since = 0;
    let cur: Live = { runId, steps: [], assistantText: "", status: "running", tokens: 0 };
    setLive(cur);
    while (true) {
      let ev: AgentEventsResponse;
      try { ev = await api.get(`/api/agent/events?runId=${runId}&since=${since}`); }
      catch (e) { append(priorHistory, [{ role: "assistant", content: `⚠ ${String(e)}` }]); setLive(null); return; }
      since = ev.cursor;
      const tokens = ev.usage?.totalTokens ?? cur.tokens;
      for (const e of ev.events as AgentEvent[]) {
        if (e.type === "tool") cur = { ...cur, steps: [...cur.steps, { tool: e.tool, args: e.args, ok: e.ok, resultSummary: e.resultSummary }] };
        else if (e.type === "assistant" && e.text) cur = { ...cur, assistantText: e.text };
        else if (e.type === "awaiting_approval") cur = { ...cur, assistantText: e.assistantText || cur.assistantText, pending: { actions: e.pendingActions } };
        else if (e.type === "done") { append(priorHistory, [{ role: "assistant", content: e.answer, actions: cur.steps, tokens }]); setLive(null); return; }
        else if (e.type === "error") { append(priorHistory, [{ role: "assistant", content: `⚠ ${e.code}: ${e.message}`, actions: cur.steps, tokens }]); setLive(null); return; }
      }
      cur = { ...cur, status: ev.status, tokens };
      setLive({ ...cur });
      if (ev.status === "awaiting_approval") return; // wait for the user
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  const ask = async () => {
    if (!prompt.trim() || !browserId || !api.ok) { setError("Need a prompt and a connected browser."); return; }
    setError("");
    const withUser = [...history, { role: "user" as const, content: prompt }];
    setMessages(withUser); setPrompt("");
    try {
      const res = await api.post("/api/agent/run", { browserId, tabId, prompt, mode, attachScreenshot: attachShot,
        history: history.slice(-12).map((m) => ({ role: m.role, content: m.content })), maxSteps, model: model || undefined });
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
  const sortedSessions = Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <section className="pad">
      <div className="row between">
        <button className="ghost sm" onClick={() => setShowList((v) => !v)} title="Previous chats">
          🗂 Chats{sortedSessions.length > 1 ? ` (${sortedSessions.length})` : ""}
        </button>
        <span className="muted ellipsis" title={current?.title} style={{ flex: 1, textAlign: "center" }}>{current?.title ?? NEW_TITLE}</span>
        <button className="ghost sm" onClick={newChat}>+ New</button>
      </div>

      {showList && (
        <div className="card">
          {sortedSessions.length === 0 && <div className="muted tiny">No saved chats.</div>}
          {sortedSessions.map((s) => (
            <div key={s.id} className="row between listrow">
              <button className="ghost sm" style={{ flex: 1, textAlign: "left", background: s.id === currentId ? "var(--soft)" : "transparent", overflow: "hidden" }}
                onClick={() => openSession(s.id)}>
                <span className="ellipsis" style={{ display: "block" }}>{s.id === currentId ? "▸ " : ""}{s.title}</span>
                <span className="muted tiny">{timeAgo(s.updatedAt)} · {s.messages.length} msg</span>
              </button>
              <button className="ghost sm danger" title="Delete chat" onClick={() => deleteSession(s.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 6 }}>
        <select value={mode} onChange={(e) => changeMode(e.target.value as AgentMode)} title={MODES.find((m) => m[0] === mode)?.[2]}>
          {MODES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={attachShot} onChange={(e) => setAttachShot(e.target.checked)} />Screenshot</label>
      </div>
      <div className="muted tiny">Actions apply to the active tab: <b>{pageLabel}</b></div>

      <div className="chatlog">
        {history.length === 0 && !live && <div className="muted">Ask me to read or act on the current page. This conversation follows you across pages — start a new chat anytime.</div>}
        {history.map((m, i) => <MessageBox key={i} msg={m} />)}

        {live && (
          <div className="card live">
            <div className="row between">
              <span className="pill">{live.pending ? "approval needed" : busy ? "working…" : live.status}{live.tokens ? ` · ${live.tokens} tok` : ""}</span>
              {busy && <button className="ghost sm danger" onClick={stop}>Stop</button>}
            </div>
            {live.steps.map((t, i) => (
              <div key={i} className="muted tiny">{t.ok ? "✓" : "✗"} {t.tool}{t.resultSummary ? ` — ${t.resultSummary}` : ""}</div>
            ))}
            {live.assistantText && <div style={{ marginTop: 4 }}><Markdown text={live.assistantText} /></div>}
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

      {slash !== null && prompts.length > 0 && (
        <div className="card" style={{ margin: "4px 0" }}>
          <div className="muted tiny">Saved prompts — click to insert</div>
          {slashMatches.length === 0 && <div className="muted tiny">no match for "/{slash}"</div>}
          {slashMatches.map((p) => (
            <div key={p.name} className="row between listrow">
              <button className="ghost sm" style={{ flex: 1, textAlign: "left" }} onClick={() => setPrompt(p.text)}>
                <b>/{p.name}</b> <span className="muted ellipsis">{p.text}</span>
              </button>
              <button className="ghost sm danger" title="Delete prompt" onClick={() => deletePrompt(p.name)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(); }}
        placeholder='Ask, or type "/" for saved prompts.  (Ctrl/⌘+Enter to send)' />
      <div className="row between">
        <button onClick={ask} disabled={busy}>{busy ? "Working…" : "Ask"}</button>
        <button className="ghost sm" onClick={saveCurrentPrompt} disabled={!prompt.trim()} title="Save the current text as a /shortcut">Save as /prompt</button>
      </div>
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
      {isUser ? <div className="prewrap">{msg.content}</div> : <Markdown text={msg.content} />}
      {!isUser && msg.tokens ? <div className="muted tiny" style={{ marginTop: 3 }}>{msg.tokens} tokens</div> : null}
    </div>
  );
}

const describeAction = (a: AgentAction) =>
  a.name === "click" ? `🖱 click ${a.args.selector}`
  : a.name === "type" ? `⌨ type "${String(a.args.text ?? "")}" into ${a.args.selector}`
  : a.name === "navigate" ? `🧭 navigate ${a.args.url}`
  : `${a.name} ${JSON.stringify(a.args)}`;
