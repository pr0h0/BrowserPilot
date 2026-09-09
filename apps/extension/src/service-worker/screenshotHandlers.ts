import { resolveTabId } from "./tabHandlers.js";

/** CSS viewport size + devicePixelRatio, after waiting for a painted frame.
 *  The rAF wait matters: captureVisibleTab grabs the last painted frame, so capturing right
 *  after an action (hover, click) can return the PREVIOUS frame and make the model correct
 *  against stale pixels. Every screenshot goes through here, so every caller gets the fix. */
export async function viewportMetrics(tabId: number): Promise<{ width: number; height: number; dpr: number } | undefined> {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => new Promise<{ width: number; height: number; dpr: number }>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() =>
          resolve({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 })))),
    });
    return res?.result as any;
  } catch { return undefined; } // chrome:// page, no host permission, …
}

export async function captureVisible(_payload: any, tabId?: number) {
  const id = await resolveTabId(tabId);
  const tab = await chrome.tabs.get(id);
  // captureVisibleTab grabs the active tab of the window; make sure target is active first.
  if (!tab.active) await chrome.tabs.update(id, { active: true });
  const viewport = await viewportMetrics(id);
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return {
      mimeType: "image/png", dataUrl, url: tab.url, title: tab.title,
      // The image is viewport * dpr pixels; click_at/hover_at take image-pixel coords.
      viewport, imageWidth: viewport && Math.round(viewport.width * viewport.dpr),
      imageHeight: viewport && Math.round(viewport.height * viewport.dpr),
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    throw Object.assign(new Error(`Screenshot failed: ${(e as Error).message}`), { code: "SCREENSHOT_FAILED" });
  }
}
