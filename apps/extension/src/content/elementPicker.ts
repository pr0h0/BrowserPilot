import type { SelectedElement } from "@browserpilot/protocol";

const isUnique = (s: string) => { try { return document.querySelectorAll(s).length === 1; } catch { return false; } };
const attrSel = (tag: string, attr: string, v: string) => `${tag}[${attr}="${v.replace(/"/g, '\\"')}"]`;

export function cssSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();
  // Prefer stable, unique hooks.
  if (el.id && isUnique(`#${CSS.escape(el.id)}`)) return `#${CSS.escape(el.id)}`;
  for (const attr of ["data-testid", "data-test", "data-qa", "data-cy", "name", "aria-label"]) {
    const v = el.getAttribute(attr);
    if (v && isUnique(attrSel(tag, attr, v))) return attrSel(tag, attr, v);
  }
  // Positional chain using :nth-child — position-stable even when a cell's state classes
  // change (e.g. .cell → .cell.revealed in a game), and verified unique. This is what makes
  // clicking a specific grid cell reliable.
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && parts.length < 12) {
    const cur: Element = node;
    if (cur.id && isUnique(`#${CSS.escape(cur.id)}`)) { parts.unshift(`#${CSS.escape(cur.id)}`); break; }
    const parent: Element | null = cur.parentElement;
    if (!parent) { parts.unshift(cur.tagName.toLowerCase()); break; }
    const idx = [...parent.children].indexOf(cur) + 1;
    parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${idx})`);
    if (isUnique(parts.join(" > "))) break; // shortest chain that's already unique
    node = parent;
  }
  return parts.join(" > ");
}

export function xpath(el: Element): string {
  if (el.id) return `//*[@id="${el.id}"]`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1) {
    let i = 1;
    let sib = node.previousElementSibling;
    while (sib) { if (sib.tagName === node.tagName) i++; sib = sib.previousElementSibling; }
    parts.unshift(`${node.tagName.toLowerCase()}[${i}]`);
    node = node.parentElement;
  }
  return "/" + parts.join("/");
}

export function describeElement(el: Element): SelectedElement {
  const rect = el.getBoundingClientRect();
  const attributes: Record<string, string> = {};
  for (const a of [...el.attributes]) attributes[a.name] = a.value;
  return {
    tag: el.tagName.toLowerCase(),
    id: (el as HTMLElement).id || "",
    classes: [...el.classList],
    selector: cssSelector(el),
    xpath: xpath(el),
    innerText: ((el as HTMLElement).innerText ?? "").slice(0, 10_000),
    outerHTML: el.outerHTML.slice(0, 20_000),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    attributes,
  };
}

// --- interactive picker overlay ---
let active = false;
let cleanup: (() => void) | null = null;

export function startPicker(onPick: (el: SelectedElement) => void, onCancel: () => void) {
  if (active) return;
  active = true;

  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #2b8cff;background:rgba(43,140,255,.15);border-radius:2px;transition:all .03s;";
  const label = document.createElement("div");
  label.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;background:#111;color:#fff;font:11px/1.4 monospace;padding:2px 6px;border-radius:3px;max-width:90vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  document.documentElement.append(overlay, label);

  let current: Element | null = null;

  const move = (e: MouseEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el === label) return;
    current = el;
    const r = el.getBoundingClientRect();
    overlay.style.left = `${r.left}px`; overlay.style.top = `${r.top}px`;
    overlay.style.width = `${r.width}px`; overlay.style.height = `${r.height}px`;
    const tag = el.tagName.toLowerCase();
    const idStr = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : "";
    const clsStr = el.classList.length ? `.${[...el.classList].slice(0, 2).join(".")}` : "";
    label.textContent = `${tag}${idStr}${clsStr}  ${Math.round(r.width)}×${Math.round(r.height)}`;
    label.style.left = `${r.left}px`; label.style.top = `${Math.max(0, r.top - 20)}px`;
  };

  const click = (e: MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (current) onPick(describeElement(current));
    stop();
  };
  const key = (e: KeyboardEvent) => { if (e.key === "Escape") { onCancel(); stop(); } };

  const stop = () => {
    active = false;
    document.removeEventListener("mousemove", move, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("keydown", key, true);
    overlay.remove(); label.remove();
    cleanup = null;
  };

  document.addEventListener("mousemove", move, true);
  document.addEventListener("click", click, true);
  document.addEventListener("keydown", key, true);
  cleanup = stop;
}

export function stopPicker() { cleanup?.(); }
