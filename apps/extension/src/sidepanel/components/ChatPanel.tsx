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
// The run in flight and the chat it belongs to. Lets a reopened panel (or a return from another
// tab of the panel) pick the run back up — including a pending approval the notification sent
// the user here for.
const LIVE_RUN = "browserpilot:liveRun";
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

/** A conversation as Markdown — what the user asked, each tool step the agent took, and its answers. */
export function chatToMarkdown(title: string, msgs: Msg[]): string {
  const parts = [`# ${title}`];
  for (const m of msgs) {
    if (m.role === "user") { parts.push(`## You\n\n${m.content}`); continue; }
    const steps = (m.actions ?? []).map((t) => `- ${t.ok ? "✓" : "✗"} \`${t.tool}\`${t.resultSummary ? ` — ${t.resultSummary}` : ""}`);
    parts.push(`## Assistant${m.tokens ? ` (${m.tokens} tokens)` : ""}\n\n${steps.length ? `${steps.join("\n")}\n\n` : ""}${m.content}`);
  }
  return parts.join("\n\n") + "\n";
}

const MODES: Array<[AgentMode, string, string]> = [
  ["read", "Read-only", "Reads the page/console but never clicks or types."],
  ["approve", "Approve actions", "Proposes each action; you approve before it runs (auto-runs on trusted sites)."],
  ["auto", "Autonomous", "Acts on its own — sensitive actions still ask; blocked sites are refused."],
];

interface Live { runId: string; steps: AgentTranscriptItem[]; assistantText: string;
  pending?: { actions: AgentAction[] }; status: string; tokens: number }

export function ChatPanel({ backendUrl, browserId, tabId, pageUrl, token, prefill, maxSteps, model, tabEnabled, onEnableTab }:
  { backendUrl?: string; browserId?: string; tabId?: number; pageUrl?: string; token?: string; prefill?: string; maxSteps?: number; model?: string;
    tabEnabled?: boolean; onEnableTab?: () => void }) {
  const [sessions, setSessions] = useState<Sessions>({});
  const [currentId, setCurrentId] = useState<string>("");
  const [showList, setShowList] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<AgentMode>("approve");
  const [attachShot, setAttachShot] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [copied, setCopied] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const stickRef = useRef(true); // follow new output only while the user is at the bottom
  // Latest sessions/currentId, so async appends (pollRun, steering) never clobber each other
  // via stale closures.
  const sessionsRef = useRef<Sessions>({});
  const currentIdRef = useRef<string>("");
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { currentIdRef.current = currentId; }, [currentId]);
  const api = makeApi(backendUrl, token);
  // Polling stops when this panel view unmounts; the next mount resumes from LIVE_RUN. Without
  // this, switching to Tools and back left an orphan poller and a run the chat no longer showed.
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  const [loaded, setLoaded] = useState(false);
  const resumeRef = useRef<{ runId: string; sessionId: string } | null>(null);

  const current = sessions[currentId];
  const history = current?.messages ?? [];
  let pageLabel = "no page";
  try { const u = new URL(pageUrl!); pageLabel = u.hostname + u.pathname; } catch { if (pageUrl) pageLabel = pageUrl; }

  // Load sessions once. Sessions are global — NOT tied to page/domain — and persist across pages.
  useEffect(() => {
    chrome.storage.local.get([SESS, CUR, OLD, MODE_STORE, PROMPTS, LIVE_RUN]).then((r) => {
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
      const lr = r[LIVE_RUN] as { runId: string; sessionId: string } | undefined;
      if (lr?.runId && sess[lr.sessionId]) { cur = lr.sessionId; resumeRef.current = lr; }
      if (!cur || !sess[cur]) {
        const ids = Object.keys(sess).sort((a, b) => sess[b].updatedAt - sess[a].updatedAt);
        if (ids.length) cur = ids[0];
        else { const s = blankSession(); sess[s.id] = s; cur = s.id; }
      }
      sessionsRef.current = sess; currentIdRef.current = cur!;
      setSessions(sess); setCurrentId(cur);
      chrome.storage.local.set({ [SESS]: sess, [CUR]: cur });
      setLoaded(true);
    });
  }, []);

  const scroller = () => scrollerRef.current ?? ((scrollerRef.current = (endRef.current?.closest(".body") as HTMLElement | null)));
  const scrollToBottom = () => { const el = scroller(); if (el) el.scrollTop = el.scrollHeight; };
  // Track whether the user is scrolled to the bottom of the panel's scroll container.
  useEffect(() => {
    const el = scroller();
    if (!el) return;
    const onScroll = () => { stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 48; };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  // Follow output only if already at the bottom (expand in place otherwise).
  useEffect(() => { if (stickRef.current) scrollToBottom(); }, [history.length, live]);
  // Switching to another chat (or opening the panel) jumps to its bottom.
  useEffect(() => { stickRef.current = true; scrollToBottom(); }, [currentId]);
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

  // Append to the CURRENT session using refs (immune to stale closures during a live run).
  const appendMsgs = (extra: Msg[]) => {
    const cid = currentIdRef.current;
    const s = sessionsRef.current[cid]; if (!s) return;
    const msgs = [...s.messages, ...extra];
    const title = s.title === NEW_TITLE ? (titleFrom(msgs) || NEW_TITLE) : s.title;
    const next = { ...sessionsRef.current, [cid]: { ...s, messages: msgs, title, updatedAt: Date.now() } };
    sessionsRef.current = next;
    setSessions(next);
    chrome.storage.local.set({ [SESS]: next, [CUR]: cid });
  };

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

  // Resume a run that was in flight when the panel last closed (settings load async, so wait for
  // the backend URL). A run the backend already swept is dropped quietly.
  useEffect(() => {
    const lr = resumeRef.current;
    if (!loaded || !lr || !api.ok) return;
    resumeRef.current = null;
    void pollRun(lr.runId, true);
  }, [loaded, backendUrl]);

  // Poll the backend event stream for a run until it finishes / needs approval. Always replays
  // from cursor 0, so the live card is rebuilt from the run's full history.
  const pollRun = async (runId: string, resuming = false) => {
    let since = 0, failures = 0;
    let cur: Live = { runId, steps: [], assistantText: "", status: "running", tokens: 0 };
    const finish = (msg?: Msg) => {
      chrome.storage.local.remove(LIVE_RUN);
      if (msg) appendMsgs([msg]);
      setLive(null);
    };
    chrome.storage.local.set({ [LIVE_RUN]: { runId, sessionId: currentIdRef.current } });
    setLive(cur);
    while (true) {
      if (!aliveRef.current) return; // unmounted: the next mount resumes from LIVE_RUN
      let ev: AgentEventsResponse;
      try { ev = await api.get(`/api/agent/events?runId=${runId}&since=${since}`); failures = 0; }
      catch (e) {
        if (!aliveRef.current) return;
        const gone = /not found or expired/.test(String(e));
        // A backend restart or a blip shouldn't throw away the run view; give it a few tries.
        if (!gone && ++failures < 6) { await new Promise((r) => setTimeout(r, 1000 * failures)); continue; }
        return finish(resuming && gone ? undefined : { role: "assistant", content: `⚠ ${String(e)}`, actions: cur.steps });
      }
      if (!aliveRef.current) return;
      since = ev.cursor;
      const tokens = ev.usage?.totalTokens ?? cur.tokens;
      for (const e of ev.events as AgentEvent[]) {
        if (e.type === "tool") cur = { ...cur, steps: [...cur.steps, { tool: e.tool, args: e.args, ok: e.ok, resultSummary: e.resultSummary }] };
        else if (e.type === "assistant" && e.text) cur = { ...cur, assistantText: e.text };
        else if (e.type === "awaiting_approval") cur = { ...cur, assistantText: e.assistantText || cur.assistantText, pending: { actions: e.pendingActions } };
        else if (e.type === "done") return finish({ role: "assistant", content: e.answer, actions: cur.steps, tokens });
        else if (e.type === "error") return finish({ role: "assistant", content: `⚠ ${e.code}: ${e.message}`, actions: cur.steps, tokens });
      }
      // The replay contains every awaiting_approval the run ever hit. Only the run's CURRENT
      // status says whether one is still open — otherwise an approved action's card came back.
      cur = { ...cur, status: ev.status, tokens, pending: ev.status === "awaiting_approval" ? cur.pending : undefined };
      setLive({ ...cur });
      if (ev.status === "awaiting_approval") return; // wait for the user
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  const ask = async () => {
    const text = prompt.trim();
    if (!text || !browserId || !api.ok) { setError("Need a prompt and a connected browser."); return; }
    if (live?.pending) { setError("Approve or reject the pending action first."); return; }
    setError(""); setPrompt("");
    appendMsgs([{ role: "user", content: text }]); // always show the user's message

    // A run is in progress → steer it (inject as a user turn before the model's next step)
    // instead of starting a new run or stopping the current one.
    if (live && live.status === "running") {
      try { const r = await api.post("/api/agent/steer", { runId: live.runId, text }); if (r?.ok) return; }
      catch { /* run may have just ended — fall through to a fresh run */ }
    }

    // Otherwise start a fresh run.
    try {
      const msgs = sessionsRef.current[currentIdRef.current]?.messages ?? [];
      const hist = msgs.slice(0, -1).slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const res = await api.post("/api/agent/run", { browserId, tabId, prompt: text, mode, attachScreenshot: attachShot, history: hist, maxSteps, model: model || undefined });
      await pollRun(res.runId);
    } catch (e) { appendMsgs([{ role: "assistant", content: `⚠ ${String(e)}` }]); }
  };

  const resolvingRef = useRef(false);
  const resolve = async (approve: boolean) => {
    if (!live || resolvingRef.current) return; // guard against double-click (the backend is also idempotent)
    resolvingRef.current = true;
    setLive({ ...live, pending: undefined, status: "running" }); // hide the approve card immediately
    try { await api.post("/api/agent/approve", { runId: live.runId, approve }); await pollRun(live.runId); }
    catch (e) { appendMsgs([{ role: "assistant", content: `⚠ ${String(e)}` }]); chrome.storage.local.remove(LIVE_RUN); setLive(null); }
    finally { resolvingRef.current = false; }
  };

  const stop = async () => { if (live) { try { await api.post("/api/agent/stop", { runId: live.runId }); } catch {} } };

  const busy = live !== null && live.status === "running";
  const pending = !!live?.pending;
  const sortedSessions = Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <section className="pad">
      <div className="row between">
        <button className="ghost sm" onClick={() => setShowList((v) => !v)} title="Previous chats">
          🗂 Chats{sortedSessions.length > 1 ? ` (${sortedSessions.length})` : ""}
        </button>
        <span className="muted ellipsis" title={current?.title} style={{ flex: 1, textAlign: "center" }}>{current?.title ?? NEW_TITLE}</span>
        <button className="ghost sm" disabled={!history.length} title="Copy this chat, with the agent's steps, as Markdown"
          onClick={async () => {
            try { await navigator.clipboard.writeText(chatToMarkdown(current?.title ?? NEW_TITLE, history)); setCopied(true); setTimeout(() => setCopied(false), 1500); }
            catch (e) { setError(`Copy failed: ${String(e)}`); }
          }}>{copied ? "✓ Copied" : "⧉ Copy"}</button>
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
      {tabId != null && tabEnabled === false && (
        <div className="card row between" style={{ borderColor: "#e67e22" }}>
          <span className="tiny">Control is off for this tab — the agent can't read or act on it.</span>
          {onEnableTab && <button className="sm" onClick={onEnableTab}>Enable</button>}
        </div>
      )}

      <div className="chatlog">
        {history.length === 0 && !live && <div className="muted">Ask me to read or act on the current page. This conversation follows you across pages — start a new chat anytime.</div>}
        {history.map((m, i) => <MessageBox key={i} msg={m} />)}

        {live && (
          <div className="card live">
            <div className="row between">
              <span className="pill">{live.pending ? "approval needed" : busy ? "working…" : live.status}{live.tokens ? ` · ${live.tokens} tok` : ""}</span>
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
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
        placeholder={busy ? "Steer the agent — your message guides its next step.  (Enter to send)" : 'Ask, or type "/" for saved prompts.  (Enter to send, Shift+Enter for newline)'} />
      <div className="row between">
        <span className="row" style={{ gap: 6 }}>
          <button onClick={ask} disabled={pending}>{busy ? "Steer" : "Ask"}</button>
          {busy && <button className="ghost danger" onClick={stop}>Stop</button>}
        </span>
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

// What the approval card shows. This is the user's whole basis for saying yes, so every action
// tool reads as a sentence rather than a JSON blob.
const describeAction = (a: AgentAction) => {
  const g = a.args as Record<string, any>;
  switch (a.name) {
    case "click": return `🖱 click ${g.selector}`;
    case "click_at": return `🖱 click at (${g.x}, ${g.y})${g.label ? ` — ${g.label}` : ""}`;
    case "type": return `⌨ type "${String(g.text ?? "")}" into ${g.selector}`;
    case "press_key": return `⌨ press ${g.key}${g.selector ? ` on ${g.selector}` : ""}`;
    case "set_field": return `☑ set ${g.selector} to ${g.checked != null ? (g.checked ? "checked" : "unchecked") : `"${g.value}"`}`;
    case "navigate": return `🧭 navigate ${g.url}`;
    case "switch_tab": return `🗂 switch to tab ${g.tabId}`;
    case "switch_frame": return `🪟 switch to frame ${g.frameId}`;
    case "drag": return `✋ drag ${g.from} → ${g.to}`;
    case "upload_file": return `📤 upload ${g.path} into ${g.selector}`;
    case "download": return `📥 download ${g.url}${g.filename ? ` as ${g.filename}` : ""}`;
    default: return `${a.name} ${JSON.stringify(g)}`;
  }
};
