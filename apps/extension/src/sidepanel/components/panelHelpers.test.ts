import { test, expect } from "bun:test";
import { chatToMarkdown } from "./ChatPanel.js";
import { frameTree } from "./PageTools.js";

test("chatToMarkdown keeps turns, steps and tokens in order", () => {
  const md = chatToMarkdown("Fix login", [
    { role: "user", content: "log me in" },
    { role: "assistant", content: "Done.", tokens: 42, actions: [
      { tool: "type", args: {}, ok: true, resultSummary: "typed into #user" },
      { tool: "click", args: {}, ok: false } ] },
  ]);
  expect(md).toBe("# Fix login\n\n## You\n\nlog me in\n\n## Assistant (42 tokens)\n\n- ✓ `type` — typed into #user\n- ✗ `click`\n\nDone.\n");
});

test("frameTree orders parents before children and tracks depth at any nesting", () => {
  const tree = frameTree([
    { frameId: 12, parentFrameId: 11, url: "c" }, { frameId: 0, parentFrameId: -1, url: "top" },
    { frameId: 11, parentFrameId: 10, url: "b" }, { frameId: 10, parentFrameId: 0, url: "a" },
    { frameId: 13, parentFrameId: 0, url: "sibling" },
  ]);
  expect(tree.map((f) => [f.frameId, f.depth])).toEqual([[0, 0], [10, 1], [11, 2], [12, 3], [13, 1]]);
});
