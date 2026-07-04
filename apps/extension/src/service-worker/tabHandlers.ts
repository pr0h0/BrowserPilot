// Tab operations via chrome.tabs. No content script needed.

const tabInfo = (t: chrome.tabs.Tab) => ({ id: t.id, url: t.url, title: t.title, active: t.active, windowId: t.windowId, index: t.index, status: t.status });

async function resolveTabId(tabId?: number): Promise<number> {
  if (tabId !== undefined) return tabId;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.id) throw Object.assign(new Error("No active tab"), { code: "TAB_NOT_FOUND" });
  return active.id;
}

export const tabHandlers: Record<string, (payload: any, tabId?: number) => Promise<unknown>> = {
  "tabs.list": async () => ({ tabs: (await chrome.tabs.query({})).map(tabInfo) }),
  "tabs.getActive": async () => {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return t ? tabInfo(t) : null;
  },
  "tabs.open": async (p) => tabInfo(await chrome.tabs.create({ url: p?.url, active: p?.active ?? true })),
  "tabs.close": async (p, tabId) => { const id = await resolveTabId(tabId ?? p?.tabId); await chrome.tabs.remove(id); return { closed: id }; },
  "tabs.reload": async (p, tabId) => { const id = await resolveTabId(tabId ?? p?.tabId); await chrome.tabs.reload(id, { bypassCache: !!p?.bypassCache }); return { reloaded: id }; },
  "tabs.activate": async (p, tabId) => { const id = await resolveTabId(tabId ?? p?.tabId); const t = await chrome.tabs.update(id, { active: true }); return tabInfo(t!); },
  "tabs.navigate": async (p, tabId) => { const id = await resolveTabId(tabId); const t = await chrome.tabs.update(id, { url: p.url }); return tabInfo(t!); },
  "tabs.goBack": async (p, tabId) => { const id = await resolveTabId(tabId); await chrome.tabs.goBack(id); return { ok: true }; },
  "tabs.goForward": async (p, tabId) => { const id = await resolveTabId(tabId); await chrome.tabs.goForward(id); return { ok: true }; },
};

export { resolveTabId };
