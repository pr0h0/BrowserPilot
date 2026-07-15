// Pure-logic tests for the agent's find ranking + history pruning. Env set before the dynamic
// import so agentService's db-client import lands on a temp DB.
import { describe, test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "bp-ah-")), "ah.sqlite")}`;
const { findElements, pruneHistory } = await import("./agentService.js");

const els = [
  { selector: "#buy", text: "Buy now", cls: "btn btn-danger red", near: "Widget", x: 10, y: 20 },
  { selector: "#cancel", text: "Cancel", cls: "btn", near: "Widget", x: 60, y: 20 },
  { selector: "#analytics1", text: "Analytics", cls: "link", near: "First video", x: 10, y: 100 },
  { selector: "#analytics2", text: "Analytics", cls: "link", near: "Second video", x: 10, y: 200 },
];

describe("findElements", () => {
  test("ranks by query-token matches; returns exact selector", () => {
    const r = findElements(els, "buy now red button");
    expect(r[0].selector).toBe("#buy"); // matches buy, now, red
    expect(r[0].score).toBeGreaterThan(0);
  });
  test("uses 'near' to disambiguate repeated controls", () => {
    const r = findElements(els, "second video analytics");
    expect(r[0].selector).toBe("#analytics2");
  });
  test("returns [] when nothing matches", () => {
    expect(findElements(els, "nonexistent zzz")).toEqual([]);
  });
  test("caps at 8 results", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ selector: `#b${i}`, text: "button", cls: "" }));
    expect(findElements(many, "button").length).toBeLessThanOrEqual(8);
  });
});

describe("pruneHistory", () => {
  const bigDump = '<untrusted_page_content>{"elements":[' + "x".repeat(900) + "]}</untrusted_page_content>";
  const build = () => ([
    { role: "user", content: "play the game" },
    { role: "assistant", tool_calls: [{ id: "c1" }] },
    { role: "tool", tool_call_id: "c1", content: bigDump },        // old, should truncate
    { role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }, // old image → strip
    { role: "assistant", tool_calls: [{ id: "c2" }] },
    { role: "tool", tool_call_id: "c2", content: bigDump },        // 2nd-newest → keep
    { role: "assistant", tool_calls: [{ id: "c3" }] },
    { role: "tool", tool_call_id: "c3", content: bigDump },        // newest → keep
    { role: "user", content: [{ type: "text", text: "here" }, { type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } }] }, // newest image → keep
    { role: "user", content: "steer" },
  ]);

  test("truncates the oldest page dump but keeps the last two", () => {
    const m = build(); pruneHistory(m);
    expect(m[2].content).toContain("older page snapshot omitted"); // oldest truncated
    expect(m[5].content).toBe(bigDump); // kept
    expect(m[7].content).toBe(bigDump); // kept
  });
  test("strips images from all but the most recent image message", () => {
    const m = build(); pruneHistory(m);
    expect(Array.isArray(m[3].content)).toBe(false); // old image stripped to text
    expect(m[3].content).toBe("look");
    expect(Array.isArray(m[8].content)).toBe(true);  // newest image kept
    expect((m[8].content as any).some((c: any) => c.type === "image_url")).toBe(true);
  });
  test("preserves tool_call/tool_result structure (roles unchanged)", () => {
    const m = build(); const roles = m.map((x) => x.role); pruneHistory(m);
    expect(m.map((x) => x.role)).toEqual(roles);
  });
  test("no-op on short histories", () => {
    const m = [{ role: "user", content: "hi" }]; pruneHistory(m);
    expect(m.length).toBe(1);
  });
});
