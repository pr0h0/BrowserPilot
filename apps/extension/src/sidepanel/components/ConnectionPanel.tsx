import { useState, useEffect } from "react";
import { sendToSw } from "../../shared/messaging.js";
import { useSettings, isLocalUrl, isSecure, type ActiveTab } from "../../shared/hooks.js";
import type { ConnectionStatus } from "../../shared/types.js";
import { ProfilePicker } from "../../shared/ProfilePicker.js";

const COLORS: Record<string, string> = { connected: "#2ecc71", connecting: "#f1c40f", disconnected: "#e74c3c" };

export function ConnectionPanel({ status, tab, onTabToggle }: { status: ConnectionStatus | null; tab: ActiveTab | null; onTabToggle: () => void }) {
  const { settings, reload } = useSettings();
  const [url, setUrl] = useState(""); const [token, setToken] = useState(""); const [name, setName] = useState("");
  const [dbg, setDbg] = useState(false); const [model, setModel] = useState(""); const [trusted, setTrusted] = useState(true);
  const [steps, setSteps] = useState(100); const [unlimited, setUnlimited] = useState(false);
  const [notify, setNotify] = useState(true);
  useEffect(() => { if (settings) {
    setUrl(settings.backendUrl); setToken(settings.pairingToken); setName(settings.browserName); setDbg(settings.enableDebugger);
    setUnlimited(settings.maxSteps === 0); setSteps(settings.maxSteps || 100); setModel(settings.model); setTrusted(settings.trustedInput); setNotify(settings.notifications);
  } }, [settings]);

  const save = async () => {
    const maxSteps = unlimited ? 0 : Math.max(1, Math.min(100000, Math.round(steps) || 100));
    await sendToSw({ kind: "saveSettings", settings: { backendUrl: url, pairingToken: token, browserName: name, enableDebugger: dbg, maxSteps, model: model.trim(), trustedInput: trusted, notifications: notify } });
    reload();
  };
  const state = status?.state ?? "disconnected";
  const warn = url && !isLocalUrl(url) && !isSecure(url);

  return (
    <section>
      <h2>Connection</h2>
      <div className="row">
        <span className="dot" style={{ background: COLORS[state] }} /><strong>{state}</strong>
        {status?.lastError && <span className="muted err">· {status.lastError}</span>}
      </div>
      <ProfilePicker settings={settings} url={url} token={token} onChange={reload} />
      <div className="row"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="ws://localhost:9876/ws" /></div>
      {warn && <div className="muted" style={{ color: "#e67e22" }}>⚠ Non-local & not WSS.</div>}
      <div className="row"><input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="pairing token (optional)" /></div>
      <div className="row"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="browser name" /></div>
      <div className="row">
        <button onClick={save}>Save</button>
        <button className="ghost" onClick={() => sendToSw({ kind: "connect" })}>Connect</button>
        <button className="ghost" onClick={() => sendToSw({ kind: "disconnect" })}>Disconnect</button>
      </div>
      <div className="muted">ID: <code>{status?.browserId}</code></div>
      <div className="muted">Tab: {tab?.title ?? "—"}<br /><code>{tab?.url}</code></div>
      <div className="row">
        <button className="ghost" onClick={onTabToggle} disabled={tab?.id == null}>
          {tab?.enabled ? "Disable control on this tab" : "Enable control on this tab"}
        </button>
        {tab?.enabled && <span className="pill">control on</span>}
      </div>
      <h2 style={{ marginTop: 10 }}>Agent</h2>
      <div className="row">
        <label className="tiny" style={{ flex: "none" }}>Model</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="backend default" />
      </div>
      <div className="muted tiny">Override the backend model (e.g. <code>deepseek-chat</code>, <code>gpt-4o-mini</code>). Blank = backend default.</div>
      <div className="row" style={{ marginTop: 4 }}>
        <label className="tiny" style={{ flex: "none" }}>Max steps / run</label>
        <input type="number" min={1} max={100000} style={{ maxWidth: 90, flex: "none" }}
          value={steps} disabled={unlimited} onChange={(e) => setSteps(Number(e.target.value))} />
        <label className="check"><input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />Unlimited</label>
      </div>
      <div className="row">
        <label className="check"><input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} />
          Trusted input (real clicks/typing)</label>
      </div>
      <div className="muted tiny">Uses the browser debugger for real <code>isTrusted</code> events — works on sites that reject synthetic clicks. Shows a "debugging this browser" banner. Off = synthetic events.</div>
      <div className="row" style={{ marginTop: 4 }}>
        <label className="check"><input type="checkbox" checked={dbg} onChange={(e) => setDbg(e.target.checked)} />
          Enable network capture / deep console</label>
      </div>
      <div className="row" style={{ marginTop: 4 }}>
        <label className="check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Desktop notifications</label>
      </div>
      <div className="muted tiny">Alerts you when a run pauses for approval, and when a run longer than 30s finishes. Off = the side panel is the only place a paused run shows.</div>
    </section>
  );
}
