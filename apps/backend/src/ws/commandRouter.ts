import type { Command, CommandResponse } from "@browserpilot/protocol";
import { registry } from "./connectionRegistry.js";
import { log } from "../util/logger.js";

/** Send a command to a browser over WS and resolve with its response (or a timeout/offline error). */
export function sendCommand(browserId: string, command: Command, timeoutMs = 30_000): Promise<CommandResponse> {
  const session = registry.get(browserId);
  if (!session || !registry.isOnline(browserId)) {
    return Promise.resolve({ id: command.id, ok: false, error: { code: "BROWSER_OFFLINE", message: `Browser ${browserId} is not connected` } });
  }
  return new Promise<CommandResponse>((resolve) => {
    registry.registerPending(command.id, browserId, resolve, timeoutMs);
    try {
      session.ws.send(JSON.stringify({ type: "command", command }));
    } catch (err) {
      log.error("ws send failed", err);
      registry.resolvePending({ id: command.id, ok: false, error: { code: "UNKNOWN_ERROR", message: String(err) } });
    }
  });
}
