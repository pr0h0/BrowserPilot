// Optional network/console capture via chrome.debugger (requires the "debugger" permission).
// ponytail: keeps a small in-memory ring per tab; emits to backend via the provided sink.
import { redactSensitiveData } from "@browserpilot/protocol";
// Attachment bookkeeping lives in cdpInput — Chrome refuses a second attach from the same
// extension, so trusted input and network capture MUST share one registry, not keep two.
import { ensureAttached as attachTab, detach as detachTab } from "./cdpInput.js";

interface NetEvent {
  url: string; method?: string; status?: number; requestUrl?: string; errorText?: string;
  durationMs?: number; requestHeaders?: Record<string, string>; responseHeaders?: Record<string, string>;
  tabId: number; timestamp: string;
}

const buffers = new Map<number, NetEvent[]>();
const startTimes = new Map<string, number>();
let emit: (e: NetEvent) => void = () => {};

export function setNetworkSink(fn: (e: NetEvent) => void) { emit = fn; }

function record(tabId: number, e: NetEvent) {
  const buf = buffers.get(tabId) ?? [];
  buf.push(e); if (buf.length > 200) buf.shift();
  buffers.set(tabId, buf);
  emit(e);
}

chrome.debugger?.onEvent.addListener((source, method, params: any) => {
  const tabId = source.tabId; if (tabId === undefined) return;
  if (method === "Network.requestWillBeSent") {
    startTimes.set(params.requestId, params.timestamp * 1000);
  } else if (method === "Network.responseReceived") {
    const r = params.response;
    record(tabId, { url: r.url, requestUrl: r.url, method: params.type, status: r.status,
      responseHeaders: redactSensitiveData(r.headers ?? {}), tabId, timestamp: new Date().toISOString() });
  } else if (method === "Network.loadingFailed") {
    record(tabId, { url: "", requestUrl: "", errorText: params.errorText, tabId, timestamp: new Date().toISOString() });
  }
});

async function ensureAttached(tabId: number) {
  if (!(await attachTab(tabId))) {
    throw Object.assign(new Error("Could not attach the debugger to this tab (another debugger may be attached)."), { code: "PERMISSION_DENIED" });
  }
}

export const debuggerHandlers: Record<string, (payload: any, tabId?: number) => Promise<unknown>> = {
  "debugger.attach": async (_p, tabId) => { await ensureAttached(need(tabId)); return { attached: tabId }; },
  "debugger.detach": async (_p, tabId) => { const id = need(tabId); await detachTab(id); return { detached: id }; },
  "network.enable": async (_p, tabId) => { const id = need(tabId); await ensureAttached(id); await chrome.debugger.sendCommand({ tabId: id }, "Network.enable"); return { enabled: id }; },
  "network.disable": async (_p, tabId) => { const id = need(tabId); await chrome.debugger.sendCommand({ tabId: id }, "Network.disable"); return { disabled: id }; },
  "network.getRecent": async (_p, tabId) => ({ events: buffers.get(need(tabId)) ?? [] }),
  "network.clearRecent": async (_p, tabId) => { buffers.set(need(tabId), []); return { cleared: true }; },
  "console.enableDeep": async (_p, tabId) => { const id = need(tabId); await ensureAttached(id); await chrome.debugger.sendCommand({ tabId: id }, "Runtime.enable"); return { enabled: id }; },
  "console.disableDeep": async (_p, tabId) => { const id = need(tabId); await chrome.debugger.sendCommand({ tabId: id }, "Runtime.disable"); return { disabled: id }; },
};

function need(tabId?: number): number {
  if (tabId === undefined) throw Object.assign(new Error("debugger commands require a tabId"), { code: "TAB_NOT_FOUND" });
  return tabId;
}
