import { type Command, type CommandResponse, ALWAYS_ALLOWED } from "@browserpilot/protocol";
import { tabHandlers, resolveTabId } from "./tabHandlers.js";
import { captureVisible } from "./screenshotHandlers.js";
import { debuggerHandlers } from "./debuggerHandlers.js";
import { ensureAttached, cdpClick, cdpType } from "./cdpInput.js";
import { isTabEnabled } from "./storage.js";
import { getSettings } from "../shared/browserApi.js";

// Only click + type need real isTrusted events. press_key stays synthetic (it explicitly
// requestSubmit()s the form on Enter, which is more reliable than native key dispatch).
const TRUSTED_ACTIONS = new Set(["page.click", "page.type"]);

/** Try to run a click/type via CDP (trusted, isTrusted:true) input. Returns the result on
 *  success, or null to signal "fall back to synthetic content-script events".
 *  Static import: a dynamic import() pulls in Vite's preload helper which references
 *  window/document and throws in the service worker. */
async function tryTrustedInput(tabId: number, type: string, payload: any, timeoutMs: number): Promise<any | null> {
  const selector: string | undefined = payload?.selector;
  if (!selector) return null;
  const loc = await sendToContent(tabId, "page.locate", { selector }, timeoutMs);
  if (!loc?.ok || !loc.result?.found) return null;                 // can't locate → fall back
  if (loc.result.isPassword) return null;                          // let content refuse password fields
  const { x, y, urlBefore } = loc.result;
  if (!(await ensureAttached(tabId))) return null;                 // no debugger → fall back
  try {
    if (type === "page.click") { await cdpClick(tabId, x, y); return { clicked: selector, trusted: true, urlBefore }; }
    if (type === "page.type") {
      await cdpType(tabId, x, y, String(payload.text ?? ""), !payload.append);
      return { typed: String(payload.text ?? "").length, selector, trusted: true, mode: payload.append ? "appended" : "replaced" };
    }
  } catch { return null; }                                         // CDP hiccup → fall back
  return null;
}

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

    // Prefer CDP trusted input for clicks/typing/keys (real isTrusted events); fall back to synthetic.
    if (TRUSTED_ACTIONS.has(type)) {
      const settings = await getSettings();
      if (settings.trustedInput) {
        const trusted = await tryTrustedInput(resolvedTab, type, payload ?? {}, timeoutMs - 500);
        if (trusted) return ok(id, trusted);
      }
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
