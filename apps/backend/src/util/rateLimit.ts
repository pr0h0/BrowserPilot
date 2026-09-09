// Failed-auth throttle. A single static pairing token guarding an API that can screenshot the
// user's browser deserves better than unlimited guesses.
// ponytail: in-memory per-process counter, no dependency. A restart clears it, and a multi-process
// deployment would need shared state — neither matters for a single self-hosted instance.

const WINDOW_MS = 15 * 60_000;
export const MAX_FAILURES = 10;

const failures = new Map<string, { count: number; first: number }>();

/** Prune expired entries so a spray of source IPs can't grow the map without bound. */
function prune(nowMs: number) {
  if (failures.size < 1000) return;
  for (const [ip, rec] of failures) if (nowMs - rec.first > WINDOW_MS) failures.delete(ip);
}

export function isLockedOut(ip: string, nowMs = Date.now()): boolean {
  const rec = failures.get(ip);
  if (!rec) return false;
  if (nowMs - rec.first > WINDOW_MS) { failures.delete(ip); return false; }
  return rec.count >= MAX_FAILURES;
}

export function recordAuthFailure(ip: string, nowMs = Date.now()): number {
  prune(nowMs);
  const rec = failures.get(ip);
  if (!rec || nowMs - rec.first > WINDOW_MS) { failures.set(ip, { count: 1, first: nowMs }); return 1; }
  rec.count += 1;
  return rec.count;
}

export function clearAuthFailures(ip: string) { failures.delete(ip); }

/** Test seam. */
export function _resetRateLimit() { failures.clear(); }
