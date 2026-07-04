import type { AgentRun, AgentStep, AgentMode, AgentTranscriptItem } from "@browserpilot/protocol";
import { config } from "../config.js";
import { id } from "../util/ids.js";
import { executeCommand } from "./commandService.js";
import { audit } from "./auditLogService.js";
import { AiError, isAiConfigured } from "./aiService.js";
import { redactSensitiveData } from "../util/redaction.js";
import { log } from "../util/logger.js";

const SYSTEM = `You are BrowserPilot, an agent that can read and act on the user's browser page.

Finding elements:
- Call list_interactive ONCE to get elements with their selector, text, bgColor, and "near" (the card/
  section title the element belongs to). Use "near" to disambiguate repeated controls — e.g. "the first
  video's Analytics button" is the Analytics element whose "near" matches the first video's title.
- Click/type ONLY with an exact selector copied from list_interactive. Never invent or guess selectors.
- If no element clearly matches the request, DO NOT guess and retry — stop and ask the user to clarify
  or to use the element picker. Repeatedly clicking similar selectors is wrong.

Acting:
- After a click, the result includes url/navigated/elementText — use it to confirm it worked. Do not
  re-list the page just to "check" unless the result shows the page actually changed.
- Prefer the fewest, safest, reversible steps. Never type into password fields.
- If a tool reports the tab is not enabled, tell the user to enable control on the tab and stop.

When finished (or stuck), briefly tell the user what you did or what you need from them.`;

// Tool name → extension command + payload builder.
const TOOL_TO_COMMAND: Record<string, { type: string; payload?: (a: any) => unknown }> = {
  list_interactive: { type: "page.listInteractive" },
  extract_text: { type: "page.extractText", payload: () => ({ maxChars: 8000 }) },
  get_selected_element: { type: "page.getSelectedElement" },
  get_console: { type: "console.getRecent" },
  click: { type: "page.click", payload: (a) => ({ selector: a.selector }) },
  type: { type: "page.type", payload: (a) => ({ selector: a.selector, text: a.text }) },
};
const READ_TOOLS = ["list_interactive", "extract_text", "get_selected_element", "get_console"];
const ACTION_TOOLS = ["click", "type"];

const TOOL_SCHEMAS: Record<string, { description: string; params: object }> = {
  list_interactive: { description: "List clickable/typeable elements with their text, CSS selector, and rendered bgColor/color. Call this before acting to find the right element.", params: { type: "object", properties: {} } },
  extract_text: { description: "Get the visible text of the current page.", params: { type: "object", properties: {} } },
  get_selected_element: { description: "Get the element the user picked with the element picker, if any.", params: { type: "object", properties: {} } },
  get_console: { description: "Get recent console errors and warnings captured on the page.", params: { type: "object", properties: {} } },
  click: { description: "Click an element by exact CSS selector (from list_interactive).", params: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } },
  type: { description: "Type text into an input/textarea by exact CSS selector.", params: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } }, required: ["selector", "text"] } },
};

interface ToolCall { id: string; name: string; args: Record<string, unknown> }
interface Session {
  provider: string; model: string; apiKey: string; baseUrl: string;
  system: string; messages: any[]; mode: AgentMode;
  browserId: string; tabId?: number;
  transcript: AgentTranscriptItem[]; pending?: ToolCall[]; iterations: number; createdAt: number;
}
const sessions = new Map<string, Session>();
const MAX_STEPS = 14;

function toolNames(mode: AgentMode) {
  return mode === "read" ? READ_TOOLS : [...READ_TOOLS, ...ACTION_TOOLS];
}

export async function agentRun(req: AgentRun): Promise<AgentStep> {
  if (!isAiConfigured()) throw new AiError("AI_NOT_CONFIGURED", "AI is not configured.");
  sweep();
  const runId = id("run");

  // Hybrid: capture a screenshot up front for visual context.
  let image: string | undefined;
  if (req.attachScreenshot) {
    const r = (await executeCommand(req.browserId, { type: "tabs.captureVisible", target: { tabId: req.tabId } })).response;
    if (r.ok && r.result && typeof (r.result as any).dataUrl === "string") image = (r.result as any).dataUrl;
  }

  const session: Session = {
    provider: config.ai.provider, model: config.ai.model, apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl,
    system: SYSTEM, messages: [buildUserTurn(config.ai.provider, req.prompt, image)],
    mode: req.mode, browserId: req.browserId, tabId: req.tabId, transcript: [], iterations: 0, createdAt: Date.now(),
  };
  sessions.set(runId, session);
  audit("agent:run", req.browserId, { mode: req.mode, tabId: req.tabId, prompt: req.prompt.slice(0, 200) });
  return step(runId);
}

export async function agentApprove(runId: string, approve: boolean): Promise<AgentStep> {
  const s = sessions.get(runId);
  if (!s) return { status: "error", runId, error: { code: "UNKNOWN_ERROR", message: "Agent run not found or expired." } };
  const pending = s.pending; s.pending = undefined;
  if (pending) {
    for (const call of pending) {
      if (approve) {
        const res = await runTool(s, call);
        pushToolResult(s, call, res.str);
        s.transcript.push({ tool: call.name, args: call.args, ok: res.ok, resultSummary: res.summary });
      } else {
        pushToolResult(s, call, JSON.stringify({ rejected: true, note: "User rejected this action." }));
        s.transcript.push({ tool: call.name, args: call.args, ok: false, resultSummary: "rejected by user" });
      }
    }
  }
  audit("agent:approve", s.browserId, { runId, approve, actions: pending?.map((p) => p.name) });
  return step(runId);
}

async function step(runId: string): Promise<AgentStep> {
  const s = sessions.get(runId)!;
  while (s.iterations < MAX_STEPS) {
    s.iterations++;
    let out: { text: string; toolCalls: ToolCall[] };
    try { out = await llmTurn(s); }
    catch (e) {
      if (e instanceof AiError) return { status: "error", runId, error: { code: e.code, message: e.message } };
      return { status: "error", runId, error: { code: "AI_REQUEST_FAILED", message: String(e) } };
    }

    if (out.toolCalls.length === 0) {
      const transcript = s.transcript;
      sessions.delete(runId);
      return { status: "done", runId, answer: out.text || "(done)", transcript };
    }

    // Approve mode: if any action is requested, pause the whole batch for user approval.
    if (s.mode === "approve" && out.toolCalls.some((c) => ACTION_TOOLS.includes(c.name))) {
      s.pending = out.toolCalls;
      return { status: "awaiting_approval", runId, assistantText: out.text, pendingActions: out.toolCalls.map((c) => ({ name: c.name, args: c.args })), transcript: s.transcript };
    }

    // Otherwise execute everything (read mode only has read tools; auto runs all).
    for (const call of out.toolCalls) {
      // Hard floor: never run an action tool in read-only mode, even if the model emits one.
      if (s.mode === "read" && ACTION_TOOLS.includes(call.name)) {
        pushToolResult(s, call, JSON.stringify({ blocked: true, note: "Read-only mode: actions are disabled." }));
        s.transcript.push({ tool: call.name, args: call.args, ok: false, resultSummary: "blocked (read-only)" });
        continue;
      }
      const res = await runTool(s, call);
      pushToolResult(s, call, res.str);
      s.transcript.push({ tool: call.name, args: call.args, ok: res.ok, resultSummary: res.summary });
    }
  }
  const transcript = s.transcript;
  sessions.delete(runId);
  return { status: "done", runId, answer: "Stopped after the maximum number of steps.", transcript };
}

async function runTool(s: Session, call: ToolCall): Promise<{ ok: boolean; str: string; summary: string }> {
  // Trust boundary: the TAB_NOT_ENABLED "hard floor" is enforced by the extension's
  // command dispatcher (commandHandlers.ts), which every executeCommand goes through.
  // Do not add a bypass here that talks to the extension by any other path.
  const map = TOOL_TO_COMMAND[call.name];
  if (!map) return { ok: false, str: JSON.stringify({ error: `unknown tool ${call.name}` }), summary: "unknown tool" };
  const payload = map.payload ? map.payload(call.args) : undefined;
  const { response } = await executeCommand(s.browserId, { type: map.type as any, target: { tabId: s.tabId }, payload });
  if (!response.ok) {
    const msg = response.error?.message ?? "failed";
    return { ok: false, str: JSON.stringify({ error: response.error?.code, message: msg }), summary: `${response.error?.code}: ${msg}`.slice(0, 120) };
  }
  const result = redactSensitiveData(response.result ?? {});
  // list_interactive can hold dozens of elements — give it room so the model sees the WHOLE page,
  // not just the first ~10. Other tools stay modest.
  const limit = call.name === "list_interactive" ? 30_000 : 6_000;
  const full = JSON.stringify(result);
  const str = full.length > limit ? full.slice(0, limit) + '…","_truncated":true}' : full;
  const summary = call.name === "click" ? `clicked ${call.args.selector}`
    : call.name === "type" ? `typed into ${call.args.selector}`
    : `${call.name} ok`;
  return { ok: true, str, summary };
}

// ---------- provider adapters ----------

function buildUserTurn(provider: string, prompt: string, image?: string): any {
  if (!image) return { role: "user", content: prompt };
  if (provider === "anthropic") {
    const m = /^data:(image\/\w+);base64,(.+)$/s.exec(image);
    const blocks: any[] = [{ type: "text", text: prompt }];
    if (m) blocks.unshift({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
    return { role: "user", content: blocks };
  }
  return { role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: image } }] };
}

function pushToolResult(s: Session, call: ToolCall, content: string) {
  if (s.provider === "anthropic") s.messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content }] });
  else s.messages.push({ role: "tool", tool_call_id: call.id, content });
}

async function llmTurn(s: Session): Promise<{ text: string; toolCalls: ToolCall[] }> {
  return s.provider === "anthropic" ? anthropicTurn(s) : openaiTurn(s);
}

async function openaiTurn(s: Session): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const tools = toolNames(s.mode).map((n) => ({ type: "function", function: { name: n, description: TOOL_SCHEMAS[n].description, parameters: TOOL_SCHEMAS[n].params } }));
  const url = `${s.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers = { "content-type": "application/json", authorization: `Bearer ${s.apiKey}` };
  const body = (msgs: any[]) => JSON.stringify({ model: s.model, messages: [{ role: "system", content: s.system }, ...msgs], tools, tool_choice: "auto", temperature: 0.2 });

  let res = await fetch(url, { method: "POST", headers, body: body(s.messages) });
  if (!res.ok) {
    const t = await res.text();
    // Strip images and retry if the provider can't take a screenshot.
    if (/image_url|image|multimodal|variant|deserialize/i.test(t) && hasImage(s.messages)) {
      s.messages = stripImages(s.messages);
      res = await fetch(url, { method: "POST", headers, body: body(s.messages) });
      if (!res.ok) throw new AiError("AI_REQUEST_FAILED", `${res.status}: ${await res.text()}`);
    } else throw new AiError("AI_REQUEST_FAILED", `${res.status}: ${t}`);
  }
  const data = await res.json() as any;
  const msg = data.choices?.[0]?.message ?? {};
  s.messages.push(msg);
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc: any) => ({ id: tc.id, name: tc.function?.name, args: safeJson(tc.function?.arguments) }));
  return { text: msg.content ?? "", toolCalls };
}

async function anthropicTurn(s: Session): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const tools = toolNames(s.mode).map((n) => ({ name: n, description: TOOL_SCHEMAS[n].description, input_schema: TOOL_SCHEMAS[n].params }));
  const root = s.baseUrl.includes("anthropic") ? s.baseUrl.replace(/\/v1\/?$/, "") : "https://api.anthropic.com";
  const res = await fetch(`${root.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": s.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: s.model, max_tokens: 1024, system: s.system, tools, messages: s.messages }),
  });
  if (!res.ok) throw new AiError("AI_REQUEST_FAILED", `${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  const content = data.content ?? [];
  s.messages.push({ role: "assistant", content });
  const toolCalls: ToolCall[] = content.filter((b: any) => b.type === "tool_use").map((b: any) => ({ id: b.id, name: b.name, args: b.input ?? {} }));
  const text = content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  return { text, toolCalls };
}

// ---------- helpers ----------
const safeJson = (s?: string) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
const hasImage = (msgs: any[]) => JSON.stringify(msgs).includes("image_url") || JSON.stringify(msgs).includes('"image"');
function stripImages(msgs: any[]) {
  return msgs.map((m) => {
    if (Array.isArray(m.content)) {
      const text = m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n") || "";
      return { ...m, content: text };
    }
    return m;
  });
}
function sweep() {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [k, v] of sessions) if (v.createdAt < cutoff) sessions.delete(k);
  if (sessions.size > 200) log.warn(`agent sessions high: ${sessions.size}`);
}
