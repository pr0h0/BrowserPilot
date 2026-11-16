import type { UiRequest, UiResponse, SwBroadcast } from "./types.js";

/** UI → service worker request/response. */
export function sendToSw(req: UiRequest): Promise<UiResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(req, (res: UiResponse) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message ?? "messaging error" });
      resolve(res ?? { ok: false, error: "no response" });
    });
  });
}

/** Subscribe to service-worker broadcasts. Returns an unsubscribe fn. */
export function onSwBroadcast(handler: (msg: SwBroadcast) => void): () => void {
  const listener = (msg: unknown) => {
    if (msg && typeof msg === "object" && "kind" in (msg as any) &&
        ["status", "elementSelected", "console", "chatPrefill", "settings"].includes((msg as any).kind)) {
      handler(msg as SwBroadcast);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

export function broadcast(msg: SwBroadcast) {
  chrome.runtime.sendMessage(msg).catch(() => { /* no UI open */ });
}
