import { useState, useEffect } from "react";
import { sendToSw } from "../shared/messaging.js";
import { useStatus, useSettings, useActiveTab, isLocalUrl, isSecure } from "../shared/hooks.js";

const COLORS: Record<string, string> = { connected: "#2ecc71", connecting: "#f1c40f", disconnected: "#e74c3c" };

export function App() {
  const status = useStatus();
  const { settings, reload } = useSettings();
  const { tab, reload: reloadTab } = useActiveTab();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [name, setName] = useState("");

  useEffect(() => { if (settings) { setUrl(settings.backendUrl); setToken(settings.pairingToken); setName(settings.browserName); } }, [settings]);

  const save = async () => { await sendToSw({ kind: "saveSettings", settings: { backendUrl: url, pairingToken: token, browserName: name } }); reload(); };
  const toggleTab = async () => { if (tab?.id == null) return; await sendToSw({ kind: "setTabEnabled", tabId: tab.id, enabled: !tab.enabled }); reloadTab(); };
  const openPanel = async () => {
    const win = await chrome.windows.getCurrent();
    try { await chrome.sidePanel.open({ windowId: win.id! }); window.close(); } catch (e) { alert("Open side panel failed: " + e); }
  };

  const state = status?.state ?? "disconnected";
  const warn = url && !isLocalUrl(url) && !isSecure(url);

  return (
    <div>
      <h1>🛩️ BrowserPilot</h1>
      <div className="row">
        <span className="dot" style={{ background: COLORS[state] }} />
        <strong>{state}</strong>
        {status?.lastError && <span className="muted">· {status.lastError}</span>}
      </div>

      <label>Backend URL</label>
      <div className="row"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="ws://localhost:9876/ws" /></div>
      {warn && <div className="muted" style={{ color: "#e67e22" }}>⚠ Non-local & not WSS. Prefer localhost or wss://.</div>}

      <label>Pairing token (optional)</label>
      <div className="row"><input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="empty in dev" /></div>

      <label>Browser name</label>
      <div className="row"><input value={name} onChange={(e) => setName(e.target.value)} /></div>

      <div className="row">
        <button onClick={save}>Save</button>
        <button className="ghost" onClick={() => sendToSw({ kind: "connect" })}>Connect</button>
        <button className="ghost" onClick={() => sendToSw({ kind: "disconnect" })}>Disconnect</button>
      </div>

      <div className="muted">Browser ID: <code>{status?.browserId ?? settings?.browserId}</code></div>

      <hr style={{ opacity: .2, margin: "10px 0" }} />
      <div className="muted">{tab?.title ?? "No active tab"}</div>
      <div className="row">
        <button className="ghost" onClick={toggleTab} disabled={tab?.id == null}>
          {tab?.enabled ? "Disable control on this tab" : "Enable control on this tab"}
        </button>
      </div>
      <div className="row"><button onClick={openPanel}>Open side panel</button></div>

      <div className="muted" style={{ textAlign: "center", marginTop: 8, fontSize: 11 }}>
        v{chrome.runtime.getManifest().version} · built {__BUILD_TIME__}
      </div>
    </div>
  );
}
