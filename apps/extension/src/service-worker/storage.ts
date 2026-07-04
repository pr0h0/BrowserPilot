// Per-tab control enablement, persisted across SW restarts via storage.session.
const KEY = "browserpilot:enabledTabs";
let enabled = new Set<number>();

export async function loadEnabledTabs() {
  try {
    const v = (await chrome.storage.session.get(KEY))[KEY] as number[] | undefined;
    if (v) enabled = new Set(v);
  } catch {}
  return enabled;
}

async function persist() {
  try { await chrome.storage.session.set({ [KEY]: [...enabled] }); } catch {}
}

export function isTabEnabled(tabId: number) { return enabled.has(tabId); }
export function enabledTabs() { return [...enabled]; }
export async function setTabEnabled(tabId: number, on: boolean) {
  if (on) enabled.add(tabId); else enabled.delete(tabId);
  await persist();
}
