import { useEffect, useState, useCallback } from "react";
import type { ConnectionStatus, Settings } from "./types.js";
import { sendToSw, onSwBroadcast } from "./messaging.js";

export function useStatus() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  useEffect(() => {
    sendToSw({ kind: "getStatus" }).then((r) => { if (r.ok) setStatus(r.data as ConnectionStatus); });
    return onSwBroadcast((m) => { if (m.kind === "status") setStatus(m.status); });
  }, []);
  return status;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const reload = useCallback(() => sendToSw({ kind: "getSettings" }).then((r) => { if (r.ok) setSettings(r.data as Settings); }), []);
  useEffect(() => { reload(); }, [reload]);
  return { settings, setSettings, reload };
}

export interface ActiveTab { id?: number; url?: string; title?: string; enabled?: boolean }
export function useActiveTab(refreshKey = 0) {
  const [tab, setTab] = useState<ActiveTab | null>(null);
  const reload = useCallback(() => sendToSw({ kind: "getActiveTab" }).then((r) => { if (r.ok) setTab(r.data as ActiveTab); }), []);
  useEffect(() => { reload(); }, [reload, refreshKey]);
  return { tab, reload };
}

export const isLocalUrl = (url: string) => /^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);
export const isSecure = (url: string) => url.startsWith("wss://");

/** ws://host:port/ws → http://host:port (REST base). */
export const httpBaseFromWs = (wsUrl: string) =>
  wsUrl.replace(/^ws/, "http").replace(/\/ws\/?$/, "");

/** Stable per-page key (origin + path, ignoring query/hash) used to keep chats separate. */
export const pageKey = (url?: string) => {
  if (!url) return "_";
  try { const u = new URL(url); return u.origin + u.pathname; } catch { return url; }
};
