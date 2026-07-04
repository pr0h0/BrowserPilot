import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";
import * as schema from "./schema.js";

mkdirSync(dirname(config.databaseUrl), { recursive: true });

const sqlite = new Database(config.databaseUrl, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL;");

// ponytail: CREATE TABLE IF NOT EXISTS on boot instead of a migration pipeline.
// `bun db:generate` still produces real migrations if you outgrow this. Add when schema churns.
sqlite.exec(`
CREATE TABLE IF NOT EXISTS browsers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, extension_version TEXT, capabilities_json TEXT,
  status TEXT NOT NULL DEFAULT 'offline', last_seen_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY, browser_id TEXT NOT NULL, tab_id INTEGER, type TEXT NOT NULL, payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending', result_json TEXT, error_json TEXT, created_at INTEGER NOT NULL, completed_at INTEGER);
CREATE TABLE IF NOT EXISTS screenshots (
  id TEXT PRIMARY KEY, browser_id TEXT NOT NULL, tab_id INTEGER, url TEXT, title TEXT,
  file_path TEXT NOT NULL, mime_type TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS console_events (
  id TEXT PRIMARY KEY, browser_id TEXT NOT NULL, tab_id INTEGER, url TEXT, level TEXT NOT NULL, message TEXT NOT NULL,
  source TEXT, line INTEGER, column INTEGER, stack TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS network_events (
  id TEXT PRIMARY KEY, browser_id TEXT NOT NULL, tab_id INTEGER, url TEXT, method TEXT, status INTEGER,
  request_url TEXT, error_text TEXT, duration_ms INTEGER, request_headers_json TEXT, response_headers_json TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY, browser_id TEXT, tab_id INTEGER, title TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, context_json TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, browser_id TEXT, action TEXT NOT NULL, details_json TEXT, created_at INTEGER NOT NULL);
`);

export const db = drizzle(sqlite, { schema });
export { schema };
