import type { WebSocket } from "ws";
import type { CommandResponse } from "@browserpilot/protocol";
import { log } from "../util/logger.js";

export interface Session {
  browserId: string;
  name: string;
  extensionVersion: string;
  capabilities: string[];
  ws: WebSocket;
  sessionId: string;
  lastSeenAt: number;
}

interface Pending {
  browserId: string;
  resolve: (r: CommandResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, Session>();
const pending = new Map<string, Pending>();

export const registry = {
  add(session: Session) {
    const existing = sessions.get(session.browserId);
    if (existing && existing.ws !== session.ws) {
      try { existing.ws.close(4000, "replaced by new connection"); } catch {}
    }
    sessions.set(session.browserId, session);
  },
  get: (browserId: string) => sessions.get(browserId),
  all: () => [...sessions.values()],
  isOnline(browserId: string) {
    const s = sessions.get(browserId);
    return !!s && Date.now() - s.lastSeenAt < 60_000;
  },
  touch(browserId: string) {
    const s = sessions.get(browserId);
    if (s) s.lastSeenAt = Date.now();
  },
  /** Live last-seen for a connected browser, or undefined when it isn't connected.
   *  Pings only refresh the in-memory session, so the DB column records when a browser last
   *  CONNECTED, not when it was last alive — a browser online for hours looks staler than one
   *  that connected recently and dropped. Callers should prefer this when it returns a value. */
  lastSeen(browserId: string): number | undefined {
    return sessions.get(browserId)?.lastSeenAt;
  },
  removeByWs(ws: WebSocket) {
    for (const [bid, s] of sessions) {
      if (s.ws === ws) {
        sessions.delete(bid);
        registry.failPendingForBrowser(bid);
        log.info(`browser disconnected: ${bid}`);
        return bid;
      }
    }
    return undefined;
  },

  // --- pending command tracking ---
  registerPending(id: string, browserId: string, resolve: (r: CommandResponse) => void, timeoutMs: number) {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ id, ok: false, error: { code: "COMMAND_TIMEOUT", message: `Command ${id} timed out after ${timeoutMs}ms` } });
    }, timeoutMs);
    pending.set(id, { browserId, resolve, timer });
  },
  resolvePending(res: CommandResponse) {
    const p = pending.get(res.id);
    if (!p) return false;
    clearTimeout(p.timer);
    pending.delete(res.id);
    p.resolve(res);
    return true;
  },
  failPendingForBrowser(browserId: string) {
    for (const [pid, p] of pending) {
      if (p.browserId !== browserId) continue;
      clearTimeout(p.timer);
      pending.delete(pid);
      p.resolve({ id: pid, ok: false, error: { code: "BROWSER_OFFLINE", message: "Browser disconnected before responding" } });
    }
  },
};
