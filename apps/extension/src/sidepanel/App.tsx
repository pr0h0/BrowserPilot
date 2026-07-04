import { useEffect, useState } from "react";
import { sendToSw, onSwBroadcast } from "../shared/messaging.js";
import { useStatus, useActiveTab, useSettings } from "../shared/hooks.js";
import type { ConsoleEvent, SelectedElement } from "../shared/types.js";
import { ConnectionPanel } from "./components/ConnectionPanel.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { PageTools } from "./components/PageTools.js";
import { SelectedElementPanel } from "./components/SelectedElementPanel.js";
import { ConsolePanel } from "./components/ConsolePanel.js";

type View = "chat" | "page" | "element" | "console" | "connection";
const COLORS: Record<string, string> = { connected: "#2ecc71", connecting: "#f1c40f", disconnected: "#e74c3c" };

export function App() {
  const status = useStatus();
  const { settings } = useSettings();
  const [tabRefresh, setTabRefresh] = useState(0);
  const { tab, reload: reloadTab } = useActiveTab(tabRefresh);
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [consoleEvents, setConsoleEvents] = useState<ConsoleEvent[]>([]);
  const [view, setView] = useState<View>("chat");

  useEffect(() => onSwBroadcast((m) => {
    if (m.kind === "elementSelected") setSelected(m.element);
    if (m.kind === "console") setConsoleEvents((c) => [...c, m.event].slice(-200));
  }), []);

  useEffect(() => {
    sendToSw({ kind: "getRecentConsole", tabId: tab?.id }).then((r) => { if (r.ok && r.data) setConsoleEvents(((r.data as any).events ?? []) as ConsoleEvent[]); });
    sendToSw({ kind: "getSelectedElement", tabId: tab?.id }).then((r) => { if (r.ok && r.data) setSelected(r.data as SelectedElement); });
  }, [tab?.id]);

  useEffect(() => {
    const bump = () => setTabRefresh((n) => n + 1);
    chrome.tabs.onActivated.addListener(bump);
    chrome.tabs.onUpdated.addListener(bump);
    return () => { chrome.tabs.onActivated.removeListener(bump); chrome.tabs.onUpdated.removeListener(bump); };
  }, []);

  const [chatPrefill, setChatPrefill] = useState("");
  const toggleTab = async () => { if (tab?.id == null) return; await sendToSw({ kind: "setTabEnabled", tabId: tab.id, enabled: !tab.enabled }); reloadTab(); };
  const askWithElement = () => {
    if (selected) setChatPrefill(`About the selected element \`${selected.selector}\` (${selected.tag}${selected.innerText ? `, "${selected.innerText.slice(0, 60)}"` : ""}): `);
    setView("chat");
  };

  const state = status?.state ?? "disconnected";
  const TABS: Array<[View, string, number?]> = [
    ["chat", "Chat"], ["page", "Page"], ["element", "Element", selected ? 1 : 0],
    ["console", "Console", consoleEvents.length], ["connection", "Connection"],
  ];

  return (
    <div>
      <header className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <strong>🛩️ BrowserPilot</strong>
        <span className="row" style={{ gap: 5 }}>
          <span className="dot" style={{ background: COLORS[state] }} />
          <span className="muted">{state}{tab?.enabled ? " · control on" : ""}</span>
        </span>
      </header>

      <nav className="tabs">
        {TABS.map(([id, label, badge]) => (
          <button key={id} className={`tab ${view === id ? "active" : ""}`} onClick={() => setView(id)}>
            {label}{badge ? <span className="badge">{badge}</span> : null}
          </button>
        ))}
      </nav>

      {view === "chat" && <ChatPanel backendUrl={settings?.backendUrl} browserId={status?.browserId} tabId={tab?.id} pageUrl={tab?.url} token={settings?.pairingToken} prefill={chatPrefill} />}
      {view === "page" && <PageTools tabId={tab?.id} />}
      {view === "element" && <SelectedElementPanel element={selected} onAskAI={askWithElement} />}
      {view === "console" && <ConsolePanel events={consoleEvents} tabId={tab?.id} onClear={() => setConsoleEvents([])} />}
      {view === "connection" && <ConnectionPanel status={status} tab={tab} onTabToggle={toggleTab} />}
    </div>
  );
}
