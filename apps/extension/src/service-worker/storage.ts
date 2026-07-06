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

// storage.session is the source of truth. Keep the in-memory set synced on every change so
// that all copies of this module (bundler may duplicate it across SW chunks) agree, and so
// the set survives service-worker restarts. Without this the command gate can read a stale set.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[KEY]) enabled = new Set((changes[KEY].newValue as number[]) ?? []);
});

async function persist() {
  try { await chrome.storage.session.set({ [KEY]: [...enabled] }); } catch {}
}

export function isTabEnabled(tabId: number) { return enabled.has(tabId); }
export function enabledTabs() { return [...enabled]; }
export async function setTabEnabled(tabId: number, on: boolean) {
  if (on) enabled.add(tabId); else enabled.delete(tabId);
  await persist();
}
