// DOM actions. Never executes arbitrary JS — only structured, named operations.

function find(selector: string): HTMLElement {
  const el = document.querySelector(selector);
  if (!el) throw Object.assign(new Error(`Element not found: ${selector}`), { code: "TAB_NOT_FOUND" });
  return el as HTMLElement;
}

function refuseIfPassword(el: HTMLElement) {
  if (el instanceof HTMLInputElement && el.type === "password") {
    throw Object.assign(new Error("Refusing to type into password field"), { code: "PERMISSION_DENIED" });
  }
}

export function click(selector: string) {
  const el = find(selector);
  el.scrollIntoView({ block: "center" });
  const before = location.href;
  const label = (el as HTMLElement).innerText?.trim().slice(0, 80) || el.getAttribute("aria-label") || el.tagName.toLowerCase();
  el.click();
  // Feedback so the agent can tell the click landed (sync signals only; navigation is async).
  return { clicked: selector, elementText: label, urlBefore: before, url: location.href, title: document.title, navigated: location.href !== before };
}

export function type(selector: string, text: string, append = false) {
  const el = find(selector) as HTMLInputElement;
  refuseIfPassword(el);
  el.focus();
  el.value = append ? (el.value ?? "") + text : text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { typed: text.length, selector, mode: append ? "appended" : "replaced" };
}

export function clear(selector: string) {
  const el = find(selector) as HTMLInputElement;
  el.focus(); el.value = "";
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return { cleared: selector };
}

export function focus(selector: string) { find(selector).focus(); return { focused: selector }; }

export function pressKey(selector: string | undefined, key: string) {
  const el = selector ? find(selector) : (document.activeElement as HTMLElement) ?? document.body;
  const keydownAllowed = el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  for (const t of ["keypress", "keyup"]) el.dispatchEvent(new KeyboardEvent(t, { key, bubbles: true, cancelable: true }));
  // Synthetic key events never trigger native behavior (they're untrusted), so emulate the
  // one that matters: Enter submits the surrounding form — unless a handler preventDefault'd.
  let submitted = false;
  if (key === "Enter" && keydownAllowed) {
    const form = (el as HTMLInputElement).form ?? el.closest?.("form");
    if (form) { form.requestSubmit(); submitted = true; }
  }
  return { pressed: key, submittedForm: submitted };
}

export function scroll(payload: { selector?: string; x?: number; y?: number; toBottom?: boolean }) {
  if (payload.selector) { find(payload.selector).scrollIntoView({ block: "center", behavior: "smooth" }); return { scrolledTo: payload.selector }; }
  if (payload.toBottom) { window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); return { scrolledToBottom: true }; }
  window.scrollTo({ left: payload.x ?? window.scrollX, top: payload.y ?? window.scrollY, behavior: "smooth" });
  return { x: payload.x, y: payload.y };
}

export function hover(selector: string) {
  const el = find(selector);
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  return { hovered: selector };
}

export function waitForSelector(selector: string, timeoutMs = 10_000): Promise<{ found: string }> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(selector)) return resolve({ found: selector });
    const obs = new MutationObserver(() => {
      if (document.querySelector(selector)) { obs.disconnect(); clearTimeout(timer); resolve({ found: selector }); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => { obs.disconnect(); reject(Object.assign(new Error(`Timeout waiting for ${selector}`), { code: "COMMAND_TIMEOUT" })); }, timeoutMs);
  });
}

export function waitForText(text: string, timeoutMs = 10_000): Promise<{ foundText: string }> {
  const has = () => (document.body?.innerText ?? "").includes(text);
  return new Promise((resolve, reject) => {
    if (has()) return resolve({ foundText: text });
    const obs = new MutationObserver(() => { if (has()) { obs.disconnect(); clearTimeout(timer); resolve({ foundText: text }); } });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const timer = setTimeout(() => { obs.disconnect(); reject(Object.assign(new Error(`Timeout waiting for text`), { code: "COMMAND_TIMEOUT" })); }, timeoutMs);
  });
}
