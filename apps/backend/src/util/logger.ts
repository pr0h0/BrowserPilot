// ponytail: console.* is a structured-enough logger for a single-user dev tool.
// Swap for pino if you ever ship this multi-tenant.
const stamp = () => new Date().toISOString();
export const log = {
  info: (msg: string, extra?: unknown) => console.log(`[${stamp()}] ${msg}`, extra ?? ""),
  warn: (msg: string, extra?: unknown) => console.warn(`[${stamp()}] WARN ${msg}`, extra ?? ""),
  error: (msg: string, extra?: unknown) => console.error(`[${stamp()}] ERROR ${msg}`, extra ?? ""),
};
