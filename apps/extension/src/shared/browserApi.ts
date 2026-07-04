import type { Settings } from "./types.js";
import { DEFAULT_BACKEND_URL } from "./types.js";

const KEY = "browserpilot:settings";

function randomId() {
  return `br_${(crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 16)}`;
}

export async function getSettings(): Promise<Settings> {
  const raw = (await chrome.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
  const settings: Settings = {
    backendUrl: raw?.backendUrl || DEFAULT_BACKEND_URL,
    pairingToken: raw?.pairingToken || "",
    browserId: raw?.browserId || randomId(),
    browserName: raw?.browserName || "My Chrome",
    enableDebugger: raw?.enableDebugger ?? false,
  };
  if (!raw?.browserId) await chrome.storage.local.set({ [KEY]: settings });
  return settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
