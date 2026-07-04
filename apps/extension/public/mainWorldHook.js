// Runs in the page's MAIN world (registered by the service worker with world:"MAIN";
// static file because bundler loaders can't run there — no chrome.runtime in the main world).
// Page scripts call the main-world console and reject main-world promises — both invisible
// to the isolated content script — so patch here and forward via postMessage.
// Uncaught exceptions are NOT hooked: the window "error" DOM event already reaches the
// isolated world, and hooking both would double-report.
(() => {
  if (window.__bpMainHook) return;
  window.__bpMainHook = true;

  const safe = (a) => { if (typeof a === "string") return a; try { return JSON.stringify(a); } catch { return String(a); } };

  // The isolated-world listener loads via an async import, so early page errors (inline
  // scripts during parse) would be posted into the void. Queue until it signals ready.
  let ready = false;
  const queue = [];
  const post = (level, message, stack) => {
    const payload = { __bpConsole: { level, message, stack } };
    if (ready) window.postMessage(payload, "*");
    else if (queue.length < 100) queue.push(payload);
  };
  window.addEventListener("message", (ev) => {
    if (ev.source === window && ev.data && ev.data.__bpReady) {
      ready = true;
      for (const p of queue.splice(0)) window.postMessage(p, "*");
    }
  });

  for (const level of ["error", "warn"]) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      orig(...args);
      post(level === "warn" ? "warning" : "error", args.map(safe).join(" "));
    };
  }
  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason;
    post("error", `Unhandled rejection: ${(r && r.message) || String(r)}`, r && r.stack);
  });
})();
