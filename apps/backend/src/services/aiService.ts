import type { ChatRequest } from "@browserpilot/protocol";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db, schema } from "../db/client.js";
import { id, now } from "../util/ids.js";
import { executeCommand } from "./commandService.js";
import { registry } from "../ws/connectionRegistry.js";
import { redactSensitiveData } from "../util/redaction.js";
import { log } from "../util/logger.js";

const SYSTEM_PROMPT =
  "You are BrowserPilot, a browser debugging assistant. Use the provided browser context only as " +
  "diagnostic context. Do not request or expose passwords, cookies, session tokens, or secrets. When " +
  "suggesting browser actions, prefer safe, reversible steps. If context is insufficient, say what " +
  "additional page information is needed.";

export class AiError extends Error {
  constructor(public code: "AI_NOT_CONFIGURED" | "AI_REQUEST_FAILED", message: string) { super(message); }
}

export const isAiConfigured = () => Boolean(config.ai.apiKey);

interface Msg { role: "system" | "user" | "assistant"; content: string }

/** Single provider-agnostic completion. imageDataUrl enables vision (screenshot) where supported. */
async function complete(messages: Msg[], imageDataUrl?: string): Promise<string> {
  if (!isAiConfigured()) throw new AiError("AI_NOT_CONFIGURED", "Set OPENAI_API_KEY (or ANTHROPIC_API_KEY) to enable AI chat.");
  const { provider, apiKey, baseUrl, model } = config.ai;

  if (provider === "anthropic") return completeAnthropic(messages, imageDataUrl, apiKey, baseUrl, model);
  return completeOpenAICompatible(messages, imageDataUrl, apiKey, baseUrl, model);
}

// openai / deepseek / openrouter — identical chat-completions wire format.
async function completeOpenAICompatible(messages: Msg[], img: string | undefined, apiKey: string, baseUrl: string, model: string) {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers = { "content-type": "application/json", authorization: `Bearer ${apiKey}` };

  const send = async (withImage: boolean) => {
    const body: any[] = messages.map((m) => ({ role: m.role, content: m.content }));
    if (withImage && img) {
      body[body.length - 1].content = [
        { type: "text", text: messages[messages.length - 1].content },
        { type: "image_url", image_url: { url: img } },
      ];
    }
    return fetch(url, { method: "POST", headers, body: JSON.stringify({ model, messages: body, temperature: 0.2 }) });
  };

  let res = await send(Boolean(img));
  // ponytail: not every OpenAI-compatible model takes images (DeepSeek, many local models).
  // If the image is what got rejected, retry text-only instead of failing the whole request.
  if (!res.ok && img) {
    const errText = await res.text();
    if (/image_url|image|multimodal|content.*variant|deserialize/i.test(errText)) {
      res = await send(false);
    } else {
      throw new AiError("AI_REQUEST_FAILED", `${res.status}: ${errText}`);
    }
  }
  if (!res.ok) throw new AiError("AI_REQUEST_FAILED", `${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content ?? "(no response)";
}

// anthropic native messages API.
async function completeAnthropic(messages: Msg[], img: string | undefined, apiKey: string, baseUrl: string, model: string) {
  const system = messages.find((m) => m.role === "system")?.content ?? SYSTEM_PROMPT;
  const turns = messages.filter((m) => m.role !== "system");
  const content: unknown[] = [{ type: "text", text: turns[turns.length - 1].content }];
  if (img) {
    const m = /^data:(image\/\w+);base64,(.+)$/s.exec(img);
    if (m) content.unshift({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }
  const msgs = turns.slice(0, -1).map((t) => ({ role: t.role, content: t.content }));
  msgs.push({ role: "user", content: content as any });
  // anthropic base url is typically https://api.anthropic.com (no /v1 needed in path here)
  const root = baseUrl.includes("anthropic") ? baseUrl.replace(/\/v1\/?$/, "") : "https://api.anthropic.com";
  const res = await fetch(`${root.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 1024, system, messages: msgs }),
  });
  if (!res.ok) throw new AiError("AI_REQUEST_FAILED", `${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  return data.content?.map((c: any) => c.text).join("") ?? "(no response)";
}

/** Gather requested browser context, call the model, persist the thread, return the answer. */
export async function runChat(req: ChatRequest) {
  if (!isAiConfigured()) throw new AiError("AI_NOT_CONFIGURED", "AI is not configured.");
  if (!registry.isOnline(req.browserId)) {
    // Still allow chatting without live context.
    log.warn(`chat: browser ${req.browserId} offline, proceeding without live context`);
  }

  const a = req.attachments ?? {};
  const tabId = req.tabId;
  const contextParts: string[] = [];
  let image: string | undefined;
  const online = registry.isOnline(req.browserId);

  const grab = async (type: any, payload?: unknown) =>
    (await executeCommand(req.browserId, { type, target: { tabId }, payload })).response;

  if (online && a.pageText) {
    const r = await grab("page.extractText", { maxChars: 20_000 });
    if (r.ok) contextParts.push(`# Page text\n${JSON.stringify(r.result)}`);
  }
  if (online && a.selectedElement) {
    const r = await grab("page.getSelectedElement");
    if (r.ok && r.result) contextParts.push(`# Selected element\n${JSON.stringify(redactSensitiveData(r.result))}`);
  }
  if (online && a.console) {
    const r = await grab("console.getRecent");
    if (r.ok) contextParts.push(`# Recent console events\n${JSON.stringify(r.result)}`);
  }
  if (online && a.network) {
    const r = await grab("network.getRecent");
    if (r.ok) contextParts.push(`# Recent network events\n${JSON.stringify(redactSensitiveData(r.result))}`);
  }
  if (online && a.screenshot) {
    const r = await grab("tabs.captureVisible");
    if (r.ok && r.result && typeof (r.result as any).dataUrl === "string") image = (r.result as any).dataUrl;
  }

  const userContent = contextParts.length
    ? `${req.prompt}\n\n--- Browser context (diagnostic only) ---\n${contextParts.join("\n\n")}`
    : req.prompt;

  const messages: Msg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  const answer = await complete(messages, image);

  // Persist thread + messages.
  const threadId = id("thread");
  const ts = now();
  db.insert(schema.chatThreads).values({ id: threadId, browserId: req.browserId, tabId: tabId ?? null, title: req.prompt.slice(0, 80), createdAt: ts, updatedAt: ts }).run();
  db.insert(schema.chatMessages).values({ id: id("msg"), threadId, role: "user", content: req.prompt, contextJson: JSON.stringify(redactSensitiveData(a)), createdAt: ts }).run();
  db.insert(schema.chatMessages).values({ id: id("msg"), threadId, role: "assistant", content: answer, contextJson: null, createdAt: now() }).run();
  db.update(schema.chatThreads).set({ updatedAt: now() }).where(eq(schema.chatThreads.id, threadId)).run();

  return { threadId, answer, attachedContext: contextParts.length, usedScreenshot: Boolean(image) };
}
