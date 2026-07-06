import type { z } from "zod";
import type {
  helloSchema, helloAckSchema, commandSchema, responseSchema, eventSchema,
  restCommandSchema, chatRequestSchema, workflowRunSchema, capabilitySchema,
  agentRunSchema, agentApproveSchema, agentModeSchema, sitePermissionSchema, scheduleSchema,
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
export type SitePermission = z.infer<typeof sitePermissionSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;

export interface AgentAction { name: string; args: Record<string, unknown> }
export type AgentStatus = "running" | "awaiting_approval" | "done" | "error";
export interface AgentTranscriptItem { tool: string; args: Record<string, unknown>; ok: boolean; resultSummary: string }

/** Live events streamed from a background agent run (polled via /api/agent/events). */
export type AgentEvent =
  | { type: "assistant"; text: string }
  | { type: "tool"; tool: string; args: Record<string, unknown>; ok: boolean; resultSummary: string }
  | { type: "awaiting_approval"; assistantText: string; pendingActions: AgentAction[]; reason?: string }
  | { type: "status"; note: string }
  | { type: "done"; answer: string }
  | { type: "error"; code: string; message: string };

export interface AgentUsage { promptTokens: number; completionTokens: number; totalTokens: number }

/** Snapshot returned by /api/agent/events?runId=&since= */
export interface AgentEventsResponse {
  runId: string;
  status: AgentStatus;
  cursor: number;         // pass back as `since` next poll
  events: AgentEvent[];
  transcript: AgentTranscriptItem[];
  usage: AgentUsage;      // cumulative token usage for the run
  model: string;
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
