import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const browsers = sqliteTable("browsers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  extensionVersion: text("extension_version"),
  capabilitiesJson: text("capabilities_json"),
  status: text("status").notNull().default("offline"),
  lastSeenAt: integer("last_seen_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const commands = sqliteTable("commands", {
  id: text("id").primaryKey(),
  browserId: text("browser_id").notNull(),
  tabId: integer("tab_id"),
  type: text("type").notNull(),
  payloadJson: text("payload_json"),
  status: text("status").notNull().default("pending"), // pending/sent/succeeded/failed/timeout
  resultJson: text("result_json"),
  errorJson: text("error_json"),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
});

export const screenshots = sqliteTable("screenshots", {
  id: text("id").primaryKey(),
  browserId: text("browser_id").notNull(),
  tabId: integer("tab_id"),
  url: text("url"),
  title: text("title"),
  filePath: text("file_path").notNull(),
  mimeType: text("mime_type").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const consoleEvents = sqliteTable("console_events", {
  id: text("id").primaryKey(),
  browserId: text("browser_id").notNull(),
  tabId: integer("tab_id"),
  url: text("url"),
  level: text("level").notNull(),
  message: text("message").notNull(),
  source: text("source"),
  line: integer("line"),
  column: integer("column"),
  stack: text("stack"),
  createdAt: integer("created_at").notNull(),
});

export const networkEvents = sqliteTable("network_events", {
  id: text("id").primaryKey(),
  browserId: text("browser_id").notNull(),
  tabId: integer("tab_id"),
  url: text("url"),
  method: text("method"),
  status: integer("status"),
  requestUrl: text("request_url"),
  errorText: text("error_text"),
  durationMs: integer("duration_ms"),
  requestHeadersJson: text("request_headers_json"),
  responseHeadersJson: text("response_headers_json"),
  createdAt: integer("created_at").notNull(),
});

export const chatThreads = sqliteTable("chat_threads", {
  id: text("id").primaryKey(),
  browserId: text("browser_id"),
  tabId: integer("tab_id"),
  title: text("title"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  contextJson: text("context_json"),
  createdAt: integer("created_at").notNull(),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  browserId: text("browser_id"),
  action: text("action").notNull(),
  detailsJson: text("details_json"),
  createdAt: integer("created_at").notNull(),
});
