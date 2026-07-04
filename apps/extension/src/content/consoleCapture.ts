import type { ConsoleEvent } from "@browserpilot/protocol";

const recent: ConsoleEvent[] = [];
const MAX = 200;
let onEvent: ((e: ConsoleEvent) => void) | null = null;

// NOTE: no chrome.storage writes in here. storage.session rejects in content scripts
// (async — try/catch can't see it), and our own unhandledrejection hook then captured
// that rejection → push → reject → … an infinite feedback loop that flooded the backend.
function push(e: ConsoleEvent) {
  recent.push(e);
  if (recent.length > MAX) recent.shift();
  onEvent?.(e);
}

const base = (level: ConsoleEvent["level"], message: string, extra: Partial<ConsoleEvent> = {}): ConsoleEvent => ({
  level, message, timestamp: new Date().toISOString(), tabId: -1, url: location.href, ...extra,
});

export function initConsoleCapture(emit: (e: ConsoleEvent) => void) {
  onEvent = emit;

  window.addEventListener("error", (ev) => {
    push(base("error", ev.message || String(ev.error), { source: ev.filename, line: ev.lineno, column: ev.colno, stack: ev.error?.stack }));
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const reason: any = ev.reason;
    push(base("error", `Unhandled rejection: ${reason?.message ?? String(reason)}`, { stack: reason?.stack }));
  });

  // Page-world console.error/warn + promise rejections, forwarded by mainWorldHook.ts —
  // the page's console object is a different one than ours, so patching alone can't see it.
  window.addEventListener("message", (ev) => {
    const d = (ev.data as any)?.__bpConsole;
    if (ev.source !== window || !d) return;
    push(base(d.level === "warning" ? "warning" : "error", String(d.message ?? ""), { stack: d.stack }));
  });
  // Tell the main-world hook we're listening — it queues page-load-time events until this.
  window.postMessage({ __bpReady: true }, "*");

  // ponytail: patch console.error/warn only (safe, reversible). Original is always called first.
  for (const level of ["error", "warn"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      push(base(level === "warn" ? "warning" : "error", args.map(stringify).join(" ")));
    };
  }
}

export const getRecentConsole = () => recent.slice();
export const clearRecentConsole = () => { recent.length = 0; };

function stringify(a: unknown) {
  if (typeof a === "string") return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}
