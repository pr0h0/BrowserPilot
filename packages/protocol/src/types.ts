import type { z } from "zod";
import type {
  helloSchema, helloAckSchema, commandSchema, responseSchema, eventSchema,
  restCommandSchema, chatRequestSchema, workflowRunSchema, capabilitySchema,
  agentRunSchema, agentApproveSchema, agentModeSchema,
} from "./schemas.js";

export type Hello = z.infer<typeof helloSchema>;
export type HelloAck = z.infer<typeof helloAckSchema>;
export type Command = z.infer<typeof commandSchema>;
export type CommandResponse = z.infer<typeof responseSchema>;
export type WsEvent = z.infer<typeof eventSchema>;
export type RestCommand = z.infer<typeof restCommandSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type AgentApprove = z.infer<typeof agentApproveSchema>;
export type AgentMode = z.infer<typeof agentModeSchema>;

export interface AgentAction { name: string; args: Record<string, unknown> }
export type AgentStep =
  | { status: "done"; runId: string; answer: string; transcript: AgentTranscriptItem[] }
  | { status: "awaiting_approval"; runId: string; assistantText: string; pendingActions: AgentAction[]; transcript: AgentTranscriptItem[] }
  | { status: "error"; runId: string; error: { code: string; message: string } };
export interface AgentTranscriptItem { tool: string; args: Record<string, unknown>; ok: boolean; resultSummary: string }

export interface InteractiveElement {
  index: number;
  tag: string;
  role: string;
  text: string;
  selector: string;
  bgColor: string;
  color: string;
  ariaLabel?: string;
  title?: string;
  near?: string;
  href?: string;
  disabled: boolean;
  rect: { x: number; y: number; width: number; height: number };
}

export interface SelectedElement {
  tag: string;
  id: string;
  classes: string[];
  selector: string;
  xpath: string;
  innerText: string;
  outerHTML: string;
  rect: { x: number; y: number; width: number; height: number };
  attributes: Record<string, string>;
}

export interface ConsoleEvent {
  level: "error" | "warning" | "info";
  message: string;
  source?: string;
  line?: number;
  column?: number;
  stack?: string;
  timestamp: string;
  tabId: number;
  url: string;
}

export interface ScreenshotResult {
  mimeType: "image/png";
  dataUrl: string;
  width?: number;
  height?: number;
  url: string;
  title: string;
  timestamp: string;
}
