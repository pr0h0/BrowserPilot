import { type Command, type CommandResponse, ALWAYS_ALLOWED } from "@browserpilot/protocol";
import { tabHandlers, resolveTabId } from "./tabHandlers.js";
import { captureVisible, viewportMetrics } from "./screenshotHandlers.js";
import { debuggerHandlers } from "./debuggerHandlers.js";
import { ensureAttached, cdpClick, cdpHover, cdpType, cdpDrag, cdpSetFiles } from "./cdpInput.js";
import { isTabEnabled } from "./storage.js";
import { getSettings } from "../shared/browserApi.js";

/** Trigger a browser download of a URL (chrome.downloads). */
function downloadFile(payload: any): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!payload?.url) return reject(Object.assign(new Error("url required"), { code: "INVALID_COMMAND" }));
    chrome.downloads.download({ url: payload.url, filename: payload.filename }, (dlId) => {
      if (chrome.runtime.lastError || dlId === undefined) reject(Object.assign(new Error(chrome.runtime.lastError?.message ?? "download failed"), { code: "UNKNOWN_ERROR" }));
      else resolve({ downloadId: dlId, url: payload.url, filename: payload.filename });
    });
  });
}

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

/** Recorded workflow steps per tab, keyed by tabId. Presence in the map == "recording".
 *  Kept in the service worker so a recording spans navigations and page reloads. */
export const recordings = new Map<number, unknown[]>();

/** Desktop notification. The agent loop runs in the backend, so a run that pauses for approval
 *  is otherwise invisible whenever the side panel is closed — which is most of the time. */
async function notify(payload: any): Promise<unknown> {
  // Enforced here rather than in the backend: the setting lives in extension storage, and this
  // is the one place every notification passes through.
  if (!(await getSettings()).notifications) return { notified: null, suppressed: true };
  return new Promise((resolve) => {
    chrome.notifications.create({
      type: "basic", iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: String(payload?.title ?? "BrowserPilot"), message: String(payload?.message ?? "").slice(0, 300),
      priority: payload?.urgent ? 2 : 0,
    }, (id) => { void chrome.runtime.lastError; resolve({ notified: id ?? null }); });
  });
}

export async function dispatchCommand(command: Command): Promise<CommandResponse> {
  const { id, type, payload, timeoutMs = 30_000 } = command;
  const tabId = command.target?.tabId;

  try {
    // 1. Tab management — always allowed.
    if (type === "ui.notify") return ok(id, await notify(payload));
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

    // Coordinate input (canvas, <video>, maps — targets with no DOM node to select). Coords are
    // SCREENSHOT-IMAGE pixels: the model reads them off the picture it was shown, and we divide by
    // the live devicePixelRatio to get the CSS px CDP wants. Skipping that scaling is the classic
    // "every click lands at double the offset on a HiDPI screen" bug. CDP only — a synthetic event
    // at a point is not what the caller asked for, so fail loudly instead of silently downgrading.
    const pt = (payload ?? {}) as any;
    if ((type === "page.click" || type === "page.hover") && pt.x != null && pt.y != null) {
      if (!Number.isFinite(Number(pt.x)) || !Number.isFinite(Number(pt.y))) return fail(id, "INVALID_COMMAND", "x and y must be numbers.");
      const dpr = (await viewportMetrics(resolvedTab))?.dpr ?? 1;
      const x = Math.round(Number(pt.x) / dpr), y = Math.round(Number(pt.y) / dpr);
      if (!(await ensureAttached(resolvedTab))) return fail(id, "PERMISSION_DENIED", "Coordinate clicking needs trusted input — enable it in BrowserPilot settings.");
      if (type === "page.hover") { await cdpHover(resolvedTab, x, y); return ok(id, { hovered: { x: pt.x, y: pt.y }, cssPoint: { x, y }, dpr }); }
      await cdpClick(resolvedTab, x, y);
      return ok(id, { clicked: { x: pt.x, y: pt.y }, cssPoint: { x, y }, dpr, trusted: true });
    }

    // Workflow recording: the SW owns the step buffer; the content script only reports events.
    if (type === "page.startRecorder") {
      recordings.set(resolvedTab, []);
      await sendToContent(resolvedTab, type, payload ?? {}, timeoutMs - 500);
      const tab = await chrome.tabs.get(resolvedTab).catch(() => undefined);
      if (tab?.url) recordings.get(resolvedTab)!.push({ type: "tabs.navigate", payload: { url: tab.url }, label: `go to ${tab.url}`, at: Date.now() });
      return ok(id, { recording: true, tabId: resolvedTab });
    }
    if (type === "page.stopRecorder") {
      const steps = recordings.get(resolvedTab) ?? [];
      recordings.delete(resolvedTab);
      await sendToContent(resolvedTab, type, payload ?? {}, timeoutMs - 500);
      return ok(id, { recording: false, steps });
    }

    // Download / drag / file-upload — need the debugger (drag/upload) or the downloads API.
    if (type === "downloads.download") return ok(id, await downloadFile(payload));
    if (type === "page.drag" || type === "page.upload") {
      const p = (payload ?? {}) as any;
      if (!(await ensureAttached(resolvedTab))) return fail(id, "PERMISSION_DENIED", "This action needs trusted input — enable it in BrowserPilot settings.");
      if (type === "page.upload") {
        const files = Array.isArray(p.files) ? p.files : p.file ? [p.file] : [];
        if (!p.selector || !files.length) return fail(id, "INVALID_COMMAND", "upload needs a selector and file path(s).");
        await cdpSetFiles(resolvedTab, p.selector, files);
        return ok(id, { uploaded: files, selector: p.selector });
      }
      const from = await sendToContent(resolvedTab, "page.locate", { selector: p.from }, timeoutMs - 500);
      const to = await sendToContent(resolvedTab, "page.locate", { selector: p.to }, timeoutMs - 500);
      if (!from?.ok || !from.result?.found) return fail(id, "TAB_NOT_FOUND", `drag source not found: ${p.from}`);
      if (!to?.ok || !to.result?.found) return fail(id, "TAB_NOT_FOUND", `drag target not found: ${p.to}`);
      await cdpDrag(resolvedTab, from.result.x, from.result.y, to.result.x, to.result.y);
      return ok(id, { dragged: p.from, to: p.to });
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
