import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const sha = (s: string) => createHash("sha256").update(s).digest();

/** Shared auth rule for the WS handshake and the REST API:
 *  token configured → must match (constant-time); no token → only when explicitly opted in.
 *
 *  The opt-in is deliberate. This used to fall back to `config.isDev`, so an instance that had
 *  never set PAIRING_TOKEN accepted everyone — and NODE_ENV=development is the easiest thing in
 *  the world to still have set when you put a hostname in front of the port. Default is now
 *  closed: no token configured means nothing authenticates, unless ALLOW_NO_TOKEN=1 says the
 *  operator really does want an open instance (local dev and the E2E harness). */
export function tokenOk(presented: string | undefined): boolean {
  if (config.pairingToken) return timingSafeEqual(sha(presented ?? ""), sha(config.pairingToken));
  return config.allowNoToken;
}

/** Extract the pairing token from an HTTP request (Authorization: Bearer or X-Pairing-Token). */
export function tokenFromHeaders(headers: Record<string, unknown>): string | undefined {
  const auth = headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7);
  const x = headers["x-pairing-token"];
  return typeof x === "string" ? x : undefined;
}
