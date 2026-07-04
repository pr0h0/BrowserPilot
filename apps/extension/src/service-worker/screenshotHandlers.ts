import { resolveTabId } from "./tabHandlers.js";

export async function captureVisible(_payload: any, tabId?: number) {
  const id = await resolveTabId(tabId);
  const tab = await chrome.tabs.get(id);
  // captureVisibleTab grabs the active tab of the window; make sure target is active first.
  if (!tab.active) await chrome.tabs.update(id, { active: true });
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return {
      mimeType: "image/png", dataUrl, url: tab.url, title: tab.title,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    throw Object.assign(new Error(`Screenshot failed: ${(e as Error).message}`), { code: "SCREENSHOT_FAILED" });
  }
}
