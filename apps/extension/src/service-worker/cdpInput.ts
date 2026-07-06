// Trusted input via the Chrome DevTools Protocol (chrome.debugger). Unlike synthetic DOM
// events, these produce isTrusted:true input that sites (React, canvas, anti-bot) accept as
// real. Attaching shows the "BrowserPilot started debugging this browser" banner on the tab.
// Every call is best-effort: on any failure the caller falls back to synthetic events.

const attached = new Set<number>();

function send<T = unknown>(tabId: number, method: string, params: object): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res as T);
    });
  });
}

export async function ensureAttached(tabId: number): Promise<boolean> {
  if (attached.has(tabId)) return true;
  try {
    await new Promise<void>((resolve, reject) =>
      chrome.debugger.attach({ tabId }, "1.3", () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()));
    attached.add(tabId);
    return true;
  } catch { return false; } // e.g. another debugger already attached, or no permission
}

export async function detach(tabId: number) {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  await new Promise<void>((resolve) => chrome.debugger.detach({ tabId }, () => { void chrome.runtime.lastError; resolve(); }));
}

const mouse = (tabId: number, type: string, x: number, y: number) =>
  send(tabId, "Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseMoved" ? 0 : 1, clickCount: 1 });

export async function cdpClick(tabId: number, x: number, y: number) {
  await mouse(tabId, "mouseMoved", x, y);
  await mouse(tabId, "mousePressed", x, y);
  await mouse(tabId, "mouseReleased", x, y);
}

async function selectAll(tabId: number) {
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, commands: ["selectAll"] });
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
}

/** Focus (via click) then insert text; replace selects-all first so it overwrites. */
export async function cdpType(tabId: number, x: number, y: number, text: string, replace: boolean) {
  await cdpClick(tabId, x, y);
  if (replace) { try { await selectAll(tabId); } catch {} }
  await send(tabId, "Input.insertText", { text });
}

const KEYS: Record<string, { key: string; code: string; vk: number; text?: string }> = {
  Enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", vk: 9 },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
  Backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  Delete: { key: "Delete", code: "Delete", vk: 46 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
};

export async function cdpPressKey(tabId: number, key: string, x?: number, y?: number) {
  if (x != null && y != null) await cdpClick(tabId, x, y);
  const k = KEYS[key] ?? { key, code: `Key${key.toUpperCase()}`, vk: key.toUpperCase().charCodeAt(0) };
  const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
  await send(tabId, "Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, text: k.text });
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

// Clean up debugger attachments when a tab closes.
chrome.tabs?.onRemoved.addListener((tabId) => { if (attached.has(tabId)) detach(tabId); });
