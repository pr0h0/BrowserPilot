import type { UiRequest, UiResponse, ConnectionStatus } from "../shared/types.js";
import { SocketClient } from "./socketClient.js";
import { setNetworkSink } from "./debuggerHandlers.js";
import { dispatchCommand } from "./commandHandlers.js";
import { loadEnabledTabs, setTabEnabled, isTabEnabled, enabledTabs } from "./storage.js";
import { getSettings, saveSettings } from "../shared/browserApi.js";

let lastStatus: ConnectionStatus | null = null;
const broadcastStatus = (status: ConnectionStatus) => {
  lastStatus = status;
  chrome.runtime.sendMessage({ kind: "status", status }).catch(() => {});
};

const socket = new SocketClient(broadcastStatus);

// Forward debugger-captured network events to the backend.
setNetworkSink((e) => socket.sendEvent("network", e as any));

// Boot: restore enabled tabs and auto-connect.
(async () => {
  await loadEnabledTabs();
  socket.connect();
})();

// Register the MAIN-world console hook (static file: bundler loaders can't run in the
// page world, so it can't go through the manifest content_scripts pipeline).
chrome.scripting.getRegisteredContentScripts({ ids: ["bp-main-hook"] })
  .then((existing) => existing.length ? null : chrome.scripting.registerContentScripts([{
    id: "bp-main-hook", js: ["mainWorldHook.js"], matches: ["<all_urls>"],
    runAt: "document_start", world: "MAIN", persistAcrossSessions: true,
  }]))
  .catch((e) => console.warn("main-world hook registration failed", e));
chrome.runtime.onStartup?.addListener(() => socket.connect());

// Open side panel is requested from popup directly (needs user gesture). Make the
// action also able to open the side panel if the user prefers.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg: any, sender, sendResponse) => {
  // --- content-script events (have a sender.tab) ---
  if (msg?.kind === "consoleEvent") {
    const tabId = sender.tab?.id ?? -1;
    const event = { ...msg.event, tabId };
    socket.sendEvent("console", event);
    chrome.runtime.sendMessage({ kind: "console", event }).catch(() => {});
    return; // no response needed
  }
  if (msg?.kind === "elementPicked") {
    chrome.runtime.sendMessage({ kind: "elementSelected", element: msg.element, tabId: sender.tab?.id ?? -1 }).catch(() => {});
    return;
  }
  if (msg?.kind === "pickerCancelled") return;

  // --- UI requests ---
  handleUi(msg as UiRequest).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async
});

async function handleUi(req: UiRequest): Promise<UiResponse> {
  switch (req?.kind) {
    case "getStatus": return { ok: true, data: lastStatus ?? socket.status() };
    case "getSettings": return { ok: true, data: await getSettings() };
    case "connect": await socket.connect(); return { ok: true, data: socket.status() };
    case "disconnect": socket.disconnect(); return { ok: true, data: socket.status() };
    case "saveSettings": {
      const next = await saveSettings(req.settings);
      // Reconnect if connection-relevant settings changed.
      if (req.settings.backendUrl || req.settings.pairingToken || req.settings.browserName) {
        socket.disconnect(); await socket.connect();
      }
      return { ok: true, data: next };
    }
    case "setTabEnabled": await setTabEnabled(req.tabId, req.enabled); broadcastStatus(socket.status()); return { ok: true, data: { enabledTabs: enabledTabs() } };
    case "getActiveTab": {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      return { ok: true, data: t ? { id: t.id, url: t.url, title: t.title, enabled: t.id ? isTabEnabled(t.id) : false } : null };
    }
    case "runCommand": {
      const tabId = req.tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      const res = await dispatchCommand({ id: `local_${Date.now()}`, type: req.commandType as any, target: { tabId }, payload: req.payload });
      return res.ok ? { ok: true, data: res.result } : { ok: false, error: res.error?.message ?? "command failed" };
    }
    case "getRecentConsole": {
      const tabId = req.tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      const res = await dispatchCommand({ id: `local_${Date.now()}`, type: "console.getRecent", target: { tabId } });
      return res.ok ? { ok: true, data: res.result } : { ok: false, error: res.error?.message ?? "failed" };
    }
    case "getSelectedElement": {
      const tabId = req.tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      const res = await dispatchCommand({ id: `local_${Date.now()}`, type: "page.getSelectedElement", target: { tabId } });
      return res.ok ? { ok: true, data: res.result } : { ok: false, error: res.error?.message ?? "failed" };
    }
    default: return { ok: false, error: "unknown request" };
  }
}

// Clean up enabled state when a tab closes.
chrome.tabs.onRemoved.addListener((tabId) => { setTabEnabled(tabId, false); });
