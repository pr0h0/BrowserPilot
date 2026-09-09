// Workflow recorder: turns what the user actually does on the page into replayable steps.
// Reuses elementPicker's cssSelector so recorded steps use the same stable, verified-unique
// selectors the agent already clicks with.
//
// Steps are pushed to the service worker as they happen rather than buffered here, because a
// recording that spans a navigation would otherwise die with the page.
import { cssSelector } from "./elementPicker.js";

export interface RecordedStep {
  type: "page.click" | "page.type" | "page.setValue" | "page.pressKey" | "tabs.navigate";
  payload: Record<string, unknown>;
  label: string;      // human-readable, for the workflow list
  at: number;
}

let recording = false;
let emit: (step: RecordedStep) => void = () => {};

const labelOf = (el: Element): string =>
  ((el as HTMLElement).innerText?.trim().split("\n")[0]
    || el.getAttribute("aria-label")
    || el.getAttribute("placeholder")
    || el.getAttribute("name")
    || el.tagName.toLowerCase()).slice(0, 60);

function push(step: Omit<RecordedStep, "at">) {
  if (!recording) return;
  emit({ ...step, at: Date.now() });
}

// Typing fires an input event per keystroke; recording each one would be useless. Instead
// record the field's final value when focus leaves it (or on Enter).
const dirty = new Map<Element, string>();

function flush(el: Element) {
  const value = dirty.get(el);
  if (value === undefined) return;
  dirty.delete(el);
  const input = el as HTMLInputElement;
  if (input.type === "password") return;        // never record a password, even locally
  const isText = /^(text|search|email|url|tel|number|textarea|)$/i.test(input.type ?? "") && !(el instanceof HTMLSelectElement);
  push({
    type: isText ? "page.type" : "page.setValue",
    payload: isText ? { selector: cssSelector(el), text: value } : { selector: cssSelector(el), value },
    label: `${isText ? "type" : "set"} "${value.slice(0, 30)}" in ${labelOf(el)}`,
  });
}

const onClick = (e: Event) => {
  const el = e.target as Element | null;
  if (!recording || !el || !(el instanceof Element)) return;
  // A click on a field the user just typed into should land after the typing step.
  flush(el);
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    push({ type: "page.setValue", payload: { selector: cssSelector(el), checked: el.checked }, label: `${el.checked ? "check" : "uncheck"} ${labelOf(el)}` });
    return;
  }
  push({ type: "page.click", payload: { selector: cssSelector(el) }, label: `click ${labelOf(el)}` });
};

const onInput = (e: Event) => {
  const el = e.target as HTMLInputElement | null;
  if (!recording || !el) return;
  if (el instanceof HTMLSelectElement) {
    push({ type: "page.setValue", payload: { selector: cssSelector(el), value: el.value }, label: `choose "${el.value}" in ${labelOf(el)}` });
    return;
  }
  dirty.set(el, el.value ?? "");
};

const onBlur = (e: Event) => { if (recording && e.target instanceof Element) flush(e.target); };

const onKey = (e: KeyboardEvent) => {
  if (!recording || e.key !== "Enter") return;
  const el = e.target as Element | null;
  if (el) flush(el);
  push({ type: "page.pressKey", payload: { selector: el ? cssSelector(el) : undefined, key: "Enter" }, label: "press Enter" });
};

export function startRecorder(sink: (step: RecordedStep) => void) {
  if (recording) return { started: true, already: true };
  emit = sink;
  recording = true;
  // Capture phase: a page that stops propagation on its own handlers must not hide the action.
  document.addEventListener("click", onClick, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onInput, true);
  document.addEventListener("blur", onBlur, true);
  document.addEventListener("keydown", onKey, true);
  return { started: true };
}

export function stopRecorder() {
  if (!recording) return { stopped: true, already: true };
  recording = false;
  dirty.clear();
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("input", onInput, true);
  document.removeEventListener("change", onInput, true);
  document.removeEventListener("blur", onBlur, true);
  document.removeEventListener("keydown", onKey, true);
  return { stopped: true };
}

export const isRecording = () => recording;
