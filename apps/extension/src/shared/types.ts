import type { SelectedElement, ConsoleEvent } from "@browserpilot/protocol";

/** A saved backend + its token, so switching servers is one click instead of retyping both. */
export interface ConnectionProfile { name: string; backendUrl: string; pairingToken: string }

export interface Settings {
  backendUrl: string;    // the ACTIVE connection — selecting a profile copies its values here
  pairingToken: string;
  profiles: ConnectionProfile[];
  browserId: string;
  browserName: string;
  enableDebugger: boolean;
  maxSteps: number;    // agent turns per run; 0 = unlimited
  model: string;       // model override sent to the backend ("" = backend default)
  trustedInput: boolean; // use CDP trusted input for clicks/typing (shows the debugging banner)
  notifications: boolean; // desktop notification when a run needs approval or finishes
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
  | { kind: "getPrefill" }
  | { kind: "runCommand"; commandType: string; tabId?: number; frameId?: number; payload?: unknown }
  | { kind: "getRecentConsole"; tabId?: number }
  | { kind: "getSelectedElement"; tabId?: number };

export type UiResponse = { ok: true; data?: unknown } | { ok: false; error: string };

/** Service worker → UI broadcast (status changed, element picked, etc.). */
export type SwBroadcast =
  | { kind: "status"; status: ConnectionStatus }
  | { kind: "elementSelected"; element: SelectedElement; tabId: number }
  | { kind: "console"; event: ConsoleEvent }
  | { kind: "chatPrefill"; text: string }
  | { kind: "settings"; settings: Settings };

export type { SelectedElement, ConsoleEvent };
