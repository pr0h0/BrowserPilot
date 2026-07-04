import { describe, test, expect } from "bun:test";
import {
  COMMAND_TYPES, commandTypeSchema, restCommandSchema, helloSchema,
  agentRunSchema, workflowRunSchema, responseSchema, ALWAYS_ALLOWED,
} from "./schemas.js";

describe("command types", () => {
  test("known types validate; unknown and removed ai.* types are rejected", () => {
    expect(commandTypeSchema.safeParse("tabs.open").success).toBe(true);
    expect(commandTypeSchema.safeParse("page.click").success).toBe(true);
    expect(commandTypeSchema.safeParse("eval").success).toBe(false);
    expect(commandTypeSchema.safeParse("ai.askCurrentPage").success).toBe(false);
    expect(commandTypeSchema.safeParse("").success).toBe(false);
  });

  test("every ALWAYS_ALLOWED entry is a real command type", () => {
    for (const t of ALWAYS_ALLOWED) expect(COMMAND_TYPES).toContain(t);
  });

  test("no page action/extraction command is ALWAYS_ALLOWED (tab gate holds)", () => {
    for (const t of ALWAYS_ALLOWED) expect(t.startsWith("page.")).toBe(false);
  });
});

describe("restCommandSchema", () => {
  test("accepts a minimal command", () => {
    expect(restCommandSchema.safeParse({ type: "tabs.list" }).success).toBe(true);
  });

  test("timeout bounds: positive int ≤ 120000", () => {
    expect(restCommandSchema.safeParse({ type: "tabs.list", timeoutMs: 1 }).success).toBe(true);
    expect(restCommandSchema.safeParse({ type: "tabs.list", timeoutMs: 0 }).success).toBe(false);
    expect(restCommandSchema.safeParse({ type: "tabs.list", timeoutMs: -5 }).success).toBe(false);
    expect(restCommandSchema.safeParse({ type: "tabs.list", timeoutMs: 120_001 }).success).toBe(false);
    expect(restCommandSchema.safeParse({ type: "tabs.list", timeoutMs: 3.5 }).success).toBe(false);
  });

  test("rejects unknown type and missing type", () => {
    expect(restCommandSchema.safeParse({ type: "shell.exec" }).success).toBe(false);
    expect(restCommandSchema.safeParse({}).success).toBe(false);
  });
});

describe("helloSchema", () => {
  const base = { type: "hello", browserId: "br_1", browserName: "b", extensionVersion: "0.1.0", capabilities: ["tabs"] };
  test("valid hello, with and without token", () => {
    expect(helloSchema.safeParse(base).success).toBe(true);
    expect(helloSchema.safeParse({ ...base, token: "t" }).success).toBe(true);
  });
  test("rejects unknown capability and missing fields", () => {
    expect(helloSchema.safeParse({ ...base, capabilities: ["root-access"] }).success).toBe(false);
    const { browserId, ...noId } = base;
    expect(helloSchema.safeParse(noId).success).toBe(false);
  });
});

describe("agentRunSchema", () => {
  test("mode defaults to approve", () => {
    const p = agentRunSchema.parse({ browserId: "b", prompt: "hi" });
    expect(p.mode).toBe("approve");
  });
  test("rejects empty prompt and unknown mode", () => {
    expect(agentRunSchema.safeParse({ browserId: "b", prompt: "" }).success).toBe(false);
    expect(agentRunSchema.safeParse({ browserId: "b", prompt: "x", mode: "yolo" }).success).toBe(false);
  });
});

describe("workflowRunSchema", () => {
  test("requires at least one step of a known type", () => {
    expect(workflowRunSchema.safeParse({ browserId: "b", name: "w", steps: [] }).success).toBe(false);
    expect(workflowRunSchema.safeParse({ browserId: "b", name: "w", steps: [{ type: "tabs.list" }] }).success).toBe(true);
    expect(workflowRunSchema.safeParse({ browserId: "b", name: "w", steps: [{ type: "eval" }] }).success).toBe(false);
  });
});

describe("responseSchema", () => {
  test("ok and error shapes", () => {
    expect(responseSchema.safeParse({ id: "c1", ok: true, result: { x: 1 } }).success).toBe(true);
    expect(responseSchema.safeParse({ id: "c1", ok: false, error: { code: "COMMAND_TIMEOUT", message: "t" } }).success).toBe(true);
    expect(responseSchema.safeParse({ ok: true }).success).toBe(false); // missing id
  });
});
