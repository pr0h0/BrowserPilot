// Page extraction helpers — run in the content script (page context via isolated world).
import { cssSelector } from "./elementPicker.js";

const SENSITIVE_NAME = /(token|csrf|secret|password|key)/i;

export function extractText(maxChars = 20_000) {
  const text = (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim();
  return { title: document.title, url: location.href, text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

export function extractMetadata() {
  const meta: Record<string, string> = {};
  document.querySelectorAll("meta[name], meta[property]").forEach((m) => {
    const k = m.getAttribute("name") || m.getAttribute("property");
    const v = m.getAttribute("content");
    if (k && v) meta[k] = v;
  });
  return { title: document.title, url: location.href, lang: document.documentElement.lang || null, meta };
}

export function extractHTML(maxChars = 50_000, redactEmail = false) {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script").forEach((s) => (s.textContent = "/* removed */"));
  clone.querySelectorAll("style").forEach((s) => (s.textContent = "/* removed */"));
  clone.querySelectorAll("input,textarea").forEach((el) => {
    const input = el as HTMLInputElement;
    const type = (input.getAttribute("type") || "").toLowerCase();
    const name = input.getAttribute("name") || input.getAttribute("id") || "";
    const sensitive = type === "password" || (redactEmail && type === "email") || SENSITIVE_NAME.test(name) ||
      type === "hidden" && SENSITIVE_NAME.test(name) || /cc|card|cvv|cvc/i.test(name);
    if (sensitive && input.hasAttribute("value")) input.setAttribute("value", "[REDACTED]");
  });
  const html = clone.outerHTML;
  return { title: document.title, url: location.href, html: html.slice(0, maxChars), truncated: html.length > maxChars };
}

export function extractLinks() {
  const links = [...document.querySelectorAll("a[href]")].map((a) => {
    const el = a as HTMLAnchorElement;
    return { text: el.innerText.trim().slice(0, 200), href: el.href, title: el.title || undefined, target: el.target || undefined };
  });
  return { count: links.length, links: links.slice(0, 1000) };
}

export function extractImages() {
  const images = [...document.querySelectorAll("img")].map((i) => {
    const el = i as HTMLImageElement;
    return { src: el.currentSrc || el.src, alt: el.alt || undefined, width: el.naturalWidth, height: el.naturalHeight };
  });
  return { count: images.length, images: images.slice(0, 500) };
}

export function extractForms() {
  const forms = [...document.querySelectorAll("form")].map((f) => {
    const form = f as HTMLFormElement;
    const fields = [...form.querySelectorAll("input,select,textarea")].map((el) => {
      const i = el as HTMLInputElement;
      const type = (i.getAttribute("type") || i.tagName.toLowerCase());
      const name = i.name || i.id || "";
      const isPassword = type === "password";
      const label = labelFor(i);
      // Never include values for password fields.
      return { name, type, label, required: i.required, placeholder: i.placeholder || undefined, value: isPassword ? undefined : (SENSITIVE_NAME.test(name) ? "[REDACTED]" : undefined) };
    });
    return { action: form.action, method: (form.method || "get").toUpperCase(), id: form.id || undefined, name: form.name || undefined, fields };
  });
  return { count: forms.length, forms };
}

export function extractTables() {
  const tables = [...document.querySelectorAll("table")].slice(0, 50).map((t) => {
    const headers = [...t.querySelectorAll("thead th, tr th")].map((h) => (h as HTMLElement).innerText.trim());
    const rows = [...t.querySelectorAll("tbody tr, tr")].slice(0, 200).map((r) =>
      [...r.querySelectorAll("td")].map((c) => (c as HTMLElement).innerText.trim()));
    return { headers, rows: rows.filter((r) => r.length) };
  });
  return { count: tables.length, tables };
}

// ---------- accessibility helpers: give the AI semantic roles / names / states ----------

/** Computed ARIA role (explicit role attr, else implicit from tag/type). */
function ariaRole(el: Element): string | undefined {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    const t = ((el as HTMLInputElement).type || "text").toLowerCase();
    return t === "checkbox" ? "checkbox" : t === "radio" ? "radio" : t === "range" ? "slider"
      : (t === "submit" || t === "button" || t === "reset") ? "button" : t === "search" ? "searchbox" : "textbox";
  }
  const map: Record<string, string> = {
    a: (el as HTMLAnchorElement).href ? "link" : "generic", button: "button", select: "combobox",
    textarea: "textbox", summary: "button", nav: "navigation", main: "main", header: "banner",
    footer: "contentinfo", aside: "complementary", form: "form",
    h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading",
  };
  return map[tag];
}

/** Accessible name: aria-label → aria-labelledby → <label> → text → placeholder → alt → title. */
function accessibleName(el: Element): string {
  const aria = el.getAttribute("aria-label"); if (aria) return aria.trim();
  const by = el.getAttribute("aria-labelledby");
  if (by) { const t = by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ").trim(); if (t) return t; }
  const input = el as HTMLInputElement;
  if (input.id) { const l = document.querySelector(`label[for="${CSS.escape(input.id)}"]`); if (l) return (l as HTMLElement).innerText.trim(); }
  const wrap = el.closest("label"); if (wrap && wrap !== el) return wrap.innerText.trim();
  const text = (el as HTMLElement).innerText?.trim(); if (text) return text;
  if (input.placeholder) return input.placeholder;
  if (input.value && (input.type === "submit" || input.type === "button")) return input.value;
  const img = el.querySelector("img") as HTMLImageElement | null; if (img?.alt) return img.alt;
  return el.getAttribute("title") || "";
}

/** Interactive states (checked/expanded/selected/pressed/disabled/current/required). */
function elementState(el: Element): string[] {
  const s: string[] = []; const g = (a: string) => el.getAttribute(a); const input = el as HTMLInputElement;
  if (input.disabled || g("aria-disabled") === "true") s.push("disabled");
  if ((input.type === "checkbox" || input.type === "radio") ? input.checked : g("aria-checked") === "true") s.push("checked");
  if (g("aria-expanded") === "true") s.push("expanded"); else if (g("aria-expanded") === "false") s.push("collapsed");
  if (g("aria-selected") === "true") s.push("selected");
  if (g("aria-pressed") === "true") s.push("pressed");
  if (g("aria-current") && g("aria-current") !== "false") s.push("current");
  if (input.required || g("aria-required") === "true") s.push("required");
  return s;
}

/** Document structure: headings (with level) and landmark regions, in reading order. */
function pageOutline() {
  const sel = "h1,h2,h3,h4,h5,h6,[role=heading],nav,main,header,footer,aside,form,section[aria-label],section[aria-labelledby]," +
    "[role=navigation],[role=main],[role=banner],[role=contentinfo],[role=complementary],[role=search],[role=region]";
  const out: Array<{ role: string; name: string; level?: number }> = [];
  document.querySelectorAll(sel).forEach((el) => {
    const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return;
    const tag = el.tagName.toLowerCase();
    const isHeading = /^h[1-6]$/.test(tag) || el.getAttribute("role") === "heading";
    const role = isHeading ? "heading" : ariaRole(el); if (!role) return;
    const name = accessibleName(el).slice(0, 80);
    if (!name && !isHeading) return;
    out.push(isHeading ? { role, name, level: Number(tag[1]) || Number(el.getAttribute("aria-level")) || 2 } : { role, name });
  });
  return out.slice(0, 60);
}

// Clickable/typeable elements with enough signal (role, accessible name, state, position) for an
// AI to pick one — including plain <div>/<td> cells that games wire up with addEventListener
// (detected by cursor:pointer), which the naive "buttons and links" query misses entirely.
export function listInteractive(max = 300) {
  const cand = new Set<Element>();
  const explicit = 'a[href], button, input, select, textarea, summary, label, [onclick], ' +
    '[role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="menuitem"], [role="option"], [role="gridcell"]';
  document.querySelectorAll(explicit).forEach((e) => cand.add(e));
  // JS-wired clickable elements (game cells, custom controls). Cap the scan to stay fast on huge pages.
  const scan = [...document.querySelectorAll<HTMLElement>("div, span, td, th, li")].slice(0, 6000);
  for (const e of scan) { if (getComputedStyle(e).cursor === "pointer") cand.add(e); }

  const visible = [...cand].filter((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  });
  // Keep the innermost clickable — drop a candidate that contains another candidate (avoids
  // listing the whole board as one giant element).
  const set = new Set(visible);
  let els = visible.filter((el) => !el.querySelector("*") || ![...el.querySelectorAll("*")].some((c) => set.has(c)));
  // Reading order: top→bottom then left→right, so array order mirrors a grid's rows.
  els.sort((a, b) => {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return (Math.round(ra.top / 10) - Math.round(rb.top / 10)) || (ra.left - rb.left);
  });
  els = els.slice(0, max);

  const items = els.map((el, index) => {
    const cs = getComputedStyle(el);
    const input = el as HTMLInputElement;
    const r = el.getBoundingClientRect();
    const img = el.querySelector("img") as HTMLImageElement | null;
    const name = accessibleName(el) || (img ? img.src.split("/").pop() ?? "" : "");
    const states = elementState(el);
    // data-* attributes and class names often carry the game state / cell value.
    const data: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) if (a.name.startsWith("data-") && a.value) data[a.name.slice(5)] = a.value.slice(0, 40);
    const cls = typeof el.className === "string" ? el.className.trim().slice(0, 80) : "";
    return clean({
      index, tag: el.tagName.toLowerCase(),
      role: ariaRole(el) || undefined,
      text: name.slice(0, 100) || undefined,           // accessible name
      state: states.length ? states.join(",") : undefined,
      value: input.value && input.type !== "password" && input.type !== "submit" && input.type !== "button" ? String(input.value).slice(0, 60) : undefined,
      selector: cssSelector(el),
      x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
      cls: cls || undefined,
      data: Object.keys(data).length ? data : undefined,
      bg: cs.backgroundColor === "rgba(0, 0, 0, 0)" ? undefined : cs.backgroundColor,
      title: el.getAttribute("title") || undefined,
      near: nearContext(el),
      href: el.tagName === "A" ? (el as HTMLAnchorElement).href : undefined,
      disabled: input.disabled || undefined,
    });
  });
  return {
    count: items.length, elements: items, outline: pageOutline(),
    note: "reading order (top-left→bottom-right). role/text(=accessible name)/state are the accessibility view; x,y are element-center viewport px; cls/data carry extra state. 'outline' is the page's heading/landmark structure.",
  };
}

// Drop undefined fields so the JSON stays small enough to fit many elements in the model's view.
const clean = <T extends Record<string, unknown>>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

// The nearest title/label that tells the AI which card/section a control belongs to
// (e.g. which video an "Analytics" button is under).
function nearContext(el: Element): string | undefined {
  const labelled = el.closest("[aria-label]");
  if (labelled && labelled !== el) { const v = labelled.getAttribute("aria-label"); if (v) return v.trim().slice(0, 80); }
  let p = el.parentElement, hops = 0;
  while (p && hops < 5) {
    const h = p.querySelector("h1,h2,h3,h4,[role='heading']") as HTMLElement | null;
    const t = h?.innerText?.trim();
    if (t) return t.slice(0, 80);
    p = p.parentElement; hops++;
  }
  return undefined;
}

export function getSelectionText() {
  const sel = window.getSelection();
  return { text: sel ? sel.toString() : "", url: location.href };
}

function labelFor(input: HTMLElement): string | undefined {
  const id = input.getAttribute("id");
  if (id) { const l = document.querySelector(`label[for="${CSS.escape(id)}"]`); if (l) return (l as HTMLElement).innerText.trim(); }
  const parentLabel = input.closest("label");
  return parentLabel ? parentLabel.innerText.trim() : undefined;
}
