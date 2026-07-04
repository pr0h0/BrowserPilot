import type { SelectedElement, ConsoleEvent } from "@browserpilot/protocol";

export interface Settings {
  backendUrl: string;
  pairingToken: string;
  browserId: string;
  browserName: string;
  enableDebugger: boolean;
}

export const DEFAULT_BACKEND_URL = "ws://localhost:9876/ws";

export interface ConnectionStatus {
  state: "connected" | "connecting" | "disconnected";
  backendUrl: string;
  browserId: string;
  browserName: string;
  sessionId?: string;
  lastError?: string;
  enabledTabs: number[];
}

/** UI (popup/sidepanel) → service worker requests. */
export type UiRequest =
  | { kind: "getStatus" }
  | { kind: "connect" }
  | { kind: "disconnect" }
  | { kind: "saveSettings"; settings: Partial<Settings> }
  | { kind: "getSettings" }
  | { kind: "setTabEnabled"; tabId: number; enabled: boolean }
  | { kind: "getActiveTab" }
  | { kind: "runCommand"; commandType: string; tabId?: number; payload?: unknown }
  | { kind: "getRecentConsole"; tabId?: number }
  | { kind: "getSelectedElement"; tabId?: number };

export type UiResponse = { ok: true; data?: unknown } | { ok: false; error: string };

/** Service worker → UI broadcast (status changed, element picked, etc.). */
export type SwBroadcast =
  | { kind: "status"; status: ConnectionStatus }
  | { kind: "elementSelected"; element: SelectedElement; tabId: number }
  | { kind: "console"; event: ConsoleEvent };

export type { SelectedElement, ConsoleEvent };
