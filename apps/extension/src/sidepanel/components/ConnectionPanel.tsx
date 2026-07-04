import { useState, useEffect } from "react";
import { sendToSw } from "../../shared/messaging.js";
import { useSettings, isLocalUrl, isSecure, type ActiveTab } from "../../shared/hooks.js";
import type { ConnectionStatus } from "../../shared/types.js";

const COLORS: Record<string, string> = { connected: "#2ecc71", connecting: "#f1c40f", disconnected: "#e74c3c" };

export function ConnectionPanel({ status, tab, onTabToggle }: { status: ConnectionStatus | null; tab: ActiveTab | null; onTabToggle: () => void }) {
  const { settings, reload } = useSettings();
  const [url, setUrl] = useState(""); const [token, setToken] = useState(""); const [name, setName] = useState("");
  const [dbg, setDbg] = useState(false);
  useEffect(() => { if (settings) { setUrl(settings.backendUrl); setToken(settings.pairingToken); setName(settings.browserName); setDbg(settings.enableDebugger); } }, [settings]);

  const save = async () => { await sendToSw({ kind: "saveSettings", settings: { backendUrl: url, pairingToken: token, browserName: name, enableDebugger: dbg } }); reload(); };
  const state = status?.state ?? "disconnected";
  const warn = url && !isLocalUrl(url) && !isSecure(url);

  return (
    <section>
      <h2>Connection</h2>
      <div className="row">
        <span className="dot" style={{ background: COLORS[state] }} /><strong>{state}</strong>
        {status?.lastError && <span className="muted err">· {status.lastError}</span>}
      </div>
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
      <div className="row">
        <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" style={{ flex: "none" }} checked={dbg} onChange={(e) => setDbg(e.target.checked)} />
          Enable debugger features (network capture, deep console)
        </label>
      </div>
      {dbg && (
        <div className="muted" style={{ fontSize: 11 }}>
          Also add <code>"debugger"</code> to <code>permissions</code> in manifest.json, rebuild, and reload the
          extension — Chrome doesn't allow it as an optional permission. Save to apply.
        </div>
      )}
    </section>
  );
}
