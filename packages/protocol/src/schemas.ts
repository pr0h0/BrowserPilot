import { z } from "zod";

/** All command types the backend may send and the extension knows how to handle.
 *  Security: commands MUST map to a known handler — unknown types are rejected. */
export const COMMAND_TYPES = [
  // tabs
  "tabs.list", "tabs.open", "tabs.close", "tabs.reload", "tabs.activate",
  "tabs.getActive", "tabs.navigate", "tabs.goBack", "tabs.goForward", "tabs.captureVisible",
  // page extraction
  "page.extractText", "page.extractHTML", "page.extractMetadata", "page.extractLinks",
  "page.extractImages", "page.extractForms", "page.extractTables", "page.getSelection",
  "page.getSelectedElement", "page.startElementPicker", "page.stopElementPicker", "page.listInteractive",
  // page actions
  "page.click", "page.type", "page.clear", "page.focus", "page.pressKey",
  "page.scroll", "page.hover", "page.waitForSelector", "page.waitForText",
  "page.setValue", "page.locate",
  // console
  "console.getRecent", "console.clearRecent",
  // phase 2 debugger / network
  "debugger.attach", "debugger.detach", "network.enable", "network.disable",
  "network.getRecent", "network.clearRecent", "console.enableDeep", "console.disableDeep",
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];
export const commandTypeSchema = z.enum(COMMAND_TYPES);

/** Commands that are allowed even when the target tab is NOT control-enabled. */
export const ALWAYS_ALLOWED: CommandType[] = [
  "tabs.list", "tabs.open", "tabs.close", "tabs.reload", "tabs.activate",
  "tabs.getActive", "tabs.navigate", "tabs.goBack", "tabs.goForward", "tabs.captureVisible",
  "console.getRecent", "console.clearRecent",
];

export const capabilitySchema = z.enum([
  "tabs", "scripting", "screenshots", "page-extract", "element-picker",
  "basic-console", "basic-actions", "ai-chat", "network",
]);

export const helloSchema = z.object({
  type: z.literal("hello"),
  browserId: z.string(),
  browserName: z.string(),
  extensionVersion: z.string(),
  token: z.string().optional(),
  capabilities: z.array(capabilitySchema),
});

export const helloAckSchema = z.object({
  type: z.literal("hello.ack"),
  ok: z.boolean(),
  serverTime: z.string(),
  sessionId: z.string(),
  error: z.string().optional(),
});

export const pingSchema = z.object({ type: z.literal("ping"), t: z.number().optional() });
export const pongSchema = z.object({ type: z.literal("pong"), t: z.number().optional() });

export const commandSchema = z.object({
  id: z.string(),
  type: commandTypeSchema,
  target: z.object({ tabId: z.number().optional(), browserId: z.string().optional() }).optional(),
  payload: z.unknown().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

export const commandEnvelopeSchema = commandSchema.extend({ type: z.literal("command").optional() });

export const responseSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }).optional(),
});

/** Async event pushed from extension → backend (console errors, network). */
export const eventSchema = z.object({
  type: z.literal("event"),
  event: z.enum(["console", "network"]),
  data: z.record(z.unknown()),
});

/** REST: body for POST /api/browsers/:id/commands */
export const restCommandSchema = z.object({
  type: commandTypeSchema,
  target: z.object({ tabId: z.number().optional() }).optional(),
  payload: z.unknown().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

export const chatRequestSchema = z.object({
  browserId: z.string(),
  tabId: z.number().optional(),
  prompt: z.string().min(1),
  model: z.string().max(120).optional(),
  attachments: z.object({
    pageText: z.boolean().optional(),
    selectedElement: z.boolean().optional(),
    screenshot: z.boolean().optional(),
    console: z.boolean().optional(),
    network: z.boolean().optional(),
  }).optional(),
});

export const agentModeSchema = z.enum(["read", "approve", "auto"]);

export const agentRunSchema = z.object({
  browserId: z.string(),
  tabId: z.number().optional(),
  prompt: z.string().min(1),
  mode: agentModeSchema.default("approve"),
  attachScreenshot: z.boolean().optional(), // hybrid: send a screenshot for visual context
  // Prior turns of this conversation (client-kept), so follow-ups have context.
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(40).optional(),
  // Max LLM turns for this run. Omit → server default (100). 0 → unlimited (Stop is the safeguard).
  maxSteps: z.number().int().min(0).max(100_000).optional(),
  // Override the backend's default model for this run (e.g. picked in the extension).
  model: z.string().max(120).optional(),
});

export const agentApproveSchema = z.object({
  runId: z.string(),
  approve: z.boolean(),
});

export const agentStopSchema = z.object({ runId: z.string() });

// Per-site permission: "always" = act without asking, "blocked" = never act. Absent = ask (default).
export const sitePermissionSchema = z.object({
  domain: z.string().min(1).max(255),
  mode: z.enum(["always", "blocked"]),
});

export const scheduleSchema = z.object({
  name: z.string().min(1).max(120),
  browserId: z.string(),
  tabId: z.number().optional(),
  prompt: z.string().min(1).max(4000),
  // Scheduled agent runs never pause for approval; they run autonomously but refuse sensitive
  // actions outright (no human to approve). Mode here selects read vs. act.
  mode: z.enum(["read", "auto"]).default("auto"),
  intervalMinutes: z.number().int().min(1).max(10_080), // 1 min .. 1 week
  enabled: z.boolean().default(true),
});

export const workflowRunSchema = z.object({
  browserId: z.string(),
  name: z.string(),
  steps: z.array(z.object({
    type: commandTypeSchema,
    target: z.object({ tabId: z.number().optional() }).optional(),
    payload: z.unknown().optional(),
    timeoutMs: z.number().int().positive().optional(),
  })).min(1),
});

/** Error codes used across the system. */
export const ERROR_CODES = {
  BROWSER_OFFLINE: "BROWSER_OFFLINE",
  COMMAND_TIMEOUT: "COMMAND_TIMEOUT",
  INVALID_COMMAND: "INVALID_COMMAND",
  TAB_NOT_FOUND: "TAB_NOT_FOUND",
  TAB_NOT_ENABLED: "TAB_NOT_ENABLED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  CONTENT_SCRIPT_FAILED: "CONTENT_SCRIPT_FAILED",
  AI_NOT_CONFIGURED: "AI_NOT_CONFIGURED",
  AI_REQUEST_FAILED: "AI_REQUEST_FAILED",
  SCREENSHOT_FAILED: "SCREENSHOT_FAILED",
  PICKER_CANCELLED: "PICKER_CANCELLED",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;
