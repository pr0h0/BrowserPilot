import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const sha = (s: string) => createHash("sha256").update(s).digest();

/** Shared auth rule for the WS handshake and the REST API:
 *  token configured → must match (constant-time); no token → dev mode only. */
export function tokenOk(presented: string | undefined): boolean {
  if (config.pairingToken) return timingSafeEqual(sha(presented ?? ""), sha(config.pairingToken));
  return config.isDev;
}

/** Extract the pairing token from an HTTP request (Authorization: Bearer or X-Pairing-Token). */
export function tokenFromHeaders(headers: Record<string, unknown>): string | undefined {
  const auth = headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7);
  const x = headers["x-pairing-token"];
  return typeof x === "string" ? x : undefined;
}
