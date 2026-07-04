import { type Command, type CommandResponse, ALWAYS_ALLOWED } from "@browserpilot/protocol";
import { tabHandlers, resolveTabId } from "./tabHandlers.js";
import { captureVisible } from "./screenshotHandlers.js";
import { debuggerHandlers } from "./debuggerHandlers.js";
import { isTabEnabled } from "./storage.js";
import { getSettings } from "../shared/browserApi.js";

const ok = (id: string, result: unknown): CommandResponse => ({ id, ok: true, result });
const fail = (id: string, code: string, message: string): CommandResponse => ({ id, ok: false, error: { code, message } });

/** Send a structured action to the content script of a tab. */
function sendToContent(tabId: number, action: string, payload: unknown, timeoutMs: number): Promise<any> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: { code: "COMMAND_TIMEOUT", message: "content script timed out" } }), timeoutMs);
    chrome.tabs.sendMessage(tabId, { __bp: true, action, payload }, (res) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: { code: "CONTENT_SCRIPT_FAILED", message: `${chrome.runtime.lastError.message}. Try reloading the page so the content script loads.` } });
      } else resolve(res);
    });
  });
}

export async function dispatchCommand(command: Command): Promise<CommandResponse> {
  const { id, type, payload, timeoutMs = 30_000 } = command;
  const tabId = command.target?.tabId;

  try {
    // 1. Tab management — always allowed.
    if (type in tabHandlers) return ok(id, await tabHandlers[type](payload, tabId));
    if (type === "tabs.captureVisible") return ok(id, await captureVisible(payload, tabId));

    // 2. Debugger/network — only if the user enabled it in settings.
    if (type in debuggerHandlers) {
      const settings = await getSettings();
      if (!settings.enableDebugger) return fail(id, "PERMISSION_DENIED", "Debugger features are disabled. Enable them in BrowserPilot settings.");
      return ok(id, await debuggerHandlers[type](payload, tabId));
    }

    // 3. Content-script commands (page.* / console.*) — require an enabled tab unless always-allowed.
    const resolvedTab = await resolveTabId(tabId);
    if (!ALWAYS_ALLOWED.includes(type as any) && !isTabEnabled(resolvedTab)) {
      return fail(id, "TAB_NOT_ENABLED", `Control is not enabled for tab ${resolvedTab}. Enable it from the popup or side panel.`);
    }
    let res = await sendToContent(resolvedTab, type, payload ?? {}, timeoutMs - 500);
    // Self-heal: tabs opened before the extension loaded have no content script — inject and retry
    // once instead of telling the user to reload. (Fails on chrome:// pages; original error stands.)
    if (!res?.ok && res?.error?.code === "CONTENT_SCRIPT_FAILED") {
      try {
        const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
        await chrome.scripting.executeScript({ target: { tabId: resolvedTab }, files });
        res = await sendToContent(resolvedTab, type, payload ?? {}, timeoutMs - 500);
      } catch { /* keep the original error */ }
    }
    if (res?.ok) return ok(id, res.result);
    return { id, ok: false, error: res?.error ?? { code: "CONTENT_SCRIPT_FAILED", message: "no response from content script" } };
  } catch (e) {
    const err = e as any;
    return fail(id, err.code ?? "UNKNOWN_ERROR", err.message ?? String(e));
  }
}
