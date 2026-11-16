import type { SelectedElement } from "@browserpilot/protocol";
import * as ex from "./pageExtractors.js";
import * as act from "./actionExecutor.js";
import { startPicker, stopPicker, describeElement } from "./elementPicker.js";
import { initConsoleCapture, getRecentConsole, clearRecentConsole } from "./consoleCapture.js";
import { startRecorder, stopRecorder, isRecording, type RecordedStep } from "./recorder.js";

let lastSelected: SelectedElement | null = null;

// The SW may inject this file into a tab that already has it (self-heal path);
// bail out of the second copy so listeners/console hooks aren't doubled.
const FLAG = "__browserpilot_cs";
const alreadyLoaded = (window as any)[FLAG] === true;
(window as any)[FLAG] = true;

// Push captured console errors up to the service worker (→ backend + UI).
if (!alreadyLoaded) initConsoleCapture((event) => {
  chrome.runtime.sendMessage({ kind: "consoleEvent", event }).catch(() => {});
});

const sendStep = (step: RecordedStep) =>
  void chrome.runtime.sendMessage({ kind: "workflowStep", step }).catch(() => {});

// A recording that crosses a navigation gets a fresh content script, which knows nothing. Ask
// the service worker (which does) whether this tab is mid-recording, and pick the thread back up.
// Top frame only: a copy injected into an iframe would otherwise join the recording and log the
// iframe's URL as a "go to" step.
if (!alreadyLoaded && window === window.top) chrome.runtime.sendMessage({ kind: "recorderQuery" })
  .then((res: any) => {
    if (!res?.recording || isRecording()) return;
    startRecorder(sendStep);
    sendStep({ type: "tabs.navigate", payload: { url: location.href }, label: `go to ${location.href}`, at: Date.now() });
  })
  .catch(() => {});

async function handle(type: string, payload: any): Promise<unknown> {
  switch (type) {
    case "page.extractText": return ex.extractText(payload?.maxChars);
    case "page.extractHTML": return ex.extractHTML(payload?.maxChars, payload?.redactEmail);
    case "page.extractMetadata": return ex.extractMetadata();
    case "page.extractLinks": return ex.extractLinks();
    case "page.extractImages": return ex.extractImages();
    case "page.extractForms": return ex.extractForms();
    case "page.extractTables": return ex.extractTables();
    case "page.getSelection": return ex.getSelectionText();
    case "page.listInteractive": return ex.listInteractive(payload?.max);
    case "page.getSelectedElement": return lastSelected;

    case "page.startElementPicker":
      startPicker(
        (el) => { lastSelected = el; chrome.runtime.sendMessage({ kind: "elementPicked", element: el }).catch(() => {}); },
        () => chrome.runtime.sendMessage({ kind: "pickerCancelled" }).catch(() => {}),
      );
      return { started: true };
    case "page.stopElementPicker": stopPicker(); return { stopped: true };

    case "page.startRecorder": return startRecorder(sendStep);
    case "page.stopRecorder": return stopRecorder();

    case "page.click": return act.click(payload.selector);
    case "page.type": return act.type(payload.selector, String(payload.text ?? ""), Boolean(payload.append));
    case "page.setValue": return act.setValue(payload.selector, payload.value, payload.checked);
    case "page.locate": return act.locate(payload.selector);
    case "page.clear": return act.clear(payload.selector);
    case "page.focus": return act.focus(payload.selector);
    case "page.pressKey": return act.pressKey(payload.selector, payload.key);
    case "page.scroll": return act.scroll(payload ?? {});
    case "page.hover": return act.hover(payload.selector);
    case "page.waitForSelector": return act.waitForSelector(payload.selector, payload.timeoutMs);
    case "page.waitForText": return act.waitForText(payload.text, payload.timeoutMs);

    case "console.getRecent": return { events: getRecentConsole().map((e) => ({ ...e, tabId: e.tabId === -1 ? undefined : e.tabId })) };
    case "console.clearRecent": clearRecentConsole(); return { cleared: true };

    default: throw Object.assign(new Error(`Unsupported content action: ${type}`), { code: "INVALID_COMMAND" });
  }
}

if (!alreadyLoaded) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.__bp !== true) return;
  // Allow re-describing an element from a CSS selector (used by side panel "send to AI").
  if (msg.action === "__describe" && msg.selector) {
    const el = document.querySelector(msg.selector);
    sendResponse(el ? { ok: true, result: describeElement(el) } : { ok: false, error: "not found" });
    return true;
  }
  handle(msg.action, msg.payload)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: { code: err.code ?? "CONTENT_SCRIPT_FAILED", message: err.message ?? String(err) } }));
  return true; // async
});
