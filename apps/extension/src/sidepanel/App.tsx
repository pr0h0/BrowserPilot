import { useEffect, useState } from "react";
import { sendToSw, onSwBroadcast } from "../shared/messaging.js";
import { useStatus, useActiveTab, useSettings } from "../shared/hooks.js";
import type { ConsoleEvent, SelectedElement } from "../shared/types.js";
import { ConnectionPanel } from "./components/ConnectionPanel.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { PageTools } from "./components/PageTools.js";
import { SelectedElementPanel } from "./components/SelectedElementPanel.js";
import { ConsolePanel } from "./components/ConsolePanel.js";
import { SitesPanel } from "./components/SitesPanel.js";
import { TasksPanel } from "./components/TasksPanel.js";
import { HistoryPanel } from "./components/HistoryPanel.js";

type View = "chat" | "tools" | "console" | "activity" | "settings";
const COLORS: Record<string, string> = { connected: "#2ecc71", connecting: "#f1c40f", disconnected: "#e74c3c" };

export function App() {
  const status = useStatus();
  const { settings } = useSettings();
  const [tabRefresh, setTabRefresh] = useState(0);
  const { tab, reload: reloadTab } = useActiveTab(tabRefresh);
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [consoleEvents, setConsoleEvents] = useState<ConsoleEvent[]>([]);
  const [view, setView] = useState<View>("chat");
  const [chatPrefill, setChatPrefill] = useState("");

  useEffect(() => onSwBroadcast((m) => {
    if (m.kind === "elementSelected") setSelected(m.element);
    if (m.kind === "console") setConsoleEvents((c) => [...c, m.event].slice(-200));
    if (m.kind === "chatPrefill") { setChatPrefill(m.text); setView("chat"); }
  }), []);

  // Pending prefill from a context-menu "Ask about selection" that opened the panel.
  useEffect(() => { sendToSw({ kind: "getPrefill" }).then((r) => { if (r.ok && r.data) { setChatPrefill(r.data as string); setView("chat"); } }); }, []);

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

  const toggleTab = async () => { if (tab?.id == null) return; await sendToSw({ kind: "setTabEnabled", tabId: tab.id, enabled: !tab.enabled }); reloadTab(); };
  const askWithElement = () => {
    if (selected) setChatPrefill(`About the selected element \`${selected.selector}\` (${selected.tag}${selected.innerText ? `, "${selected.innerText.slice(0, 60)}"` : ""}): `);
    setView("chat");
  };

  const state = status?.state ?? "disconnected";
  const TABS: Array<[View, string, string, number?]> = [
    ["chat", "💬", "Chat"],
    ["tools", "🧰", "Tools", selected ? 1 : 0],
    ["console", "🐛", "Console", consoleEvents.length],
    ["activity", "📋", "Activity"],
    ["settings", "⚙️", "Settings"],
  ];
  const common = { backendUrl: settings?.backendUrl, token: settings?.pairingToken, browserId: status?.browserId };

  return (
    <div className="app">
      <header className="topbar">
        <strong>🛩️ BrowserPilot</strong>
        <span className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ background: COLORS[state] }} />
          <span className="muted tiny">{state}{tab?.enabled ? " · control on" : ""}</span>
          <button className="ghost sm" title="Close side panel" onClick={() => window.close()}>✕</button>
        </span>
      </header>

      <nav className="tabs">
        {TABS.map(([id, icon, label, badge]) => (
          <button key={id} className={`tab ${view === id ? "active" : ""}`} onClick={() => setView(id)} title={label}>
            <span className="tabicon">{icon}</span><span className="tablabel">{label}</span>
            {badge ? <span className="badge">{badge}</span> : null}
          </button>
        ))}
      </nav>

      <main className="body">
        {view === "chat" && <ChatPanel {...common} tabId={tab?.id} pageUrl={tab?.url} prefill={chatPrefill} />}
        {view === "tools" && <>
          <PageTools tabId={tab?.id} />
          <SelectedElementPanel element={selected} onAskAI={askWithElement} />
        </>}
        {view === "console" && <ConsolePanel events={consoleEvents} tabId={tab?.id} onClear={() => setConsoleEvents([])} />}
        {view === "activity" && <HistoryPanel {...common} />}
        {view === "settings" && <>
          <ConnectionPanel status={status} tab={tab} onTabToggle={toggleTab} />
          <SitesPanel {...common} pageUrl={tab?.url} />
          <TasksPanel {...common} tabId={tab?.id} />
        </>}
      </main>
    </div>
  );
}
