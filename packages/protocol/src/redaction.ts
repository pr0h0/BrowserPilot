const SENSITIVE = [
  "authorization", "cookie", "set-cookie", "x-api-key", "x-shopify-access-token",
  "api_key", "access_token", "refresh_token", "password", "secret",
  "private_key", "csrf", "token",
];

const isSensitiveKey = (key: string) => {
  const k = key.toLowerCase();
  return SENSITIVE.some((s) => k.includes(s));
};

// Secret-shaped substrings inside free text (page text, console messages, stack traces).
const VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9\-._~+/]{8,}=*/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, // JWT
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // common API-key shape
];
const KV_PATTERN = new RegExp(
  `\\b(${SENSITIVE.map((s) => s.replace(/[-_]/g, "[-_]?")).join("|")})\\b(\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s"'\`,;&)}\\]]+)`,
  "gi",
);

/** Scrub secret-shaped values embedded in a plain string. */
export function redactText(input: string): string {
  let out = input;
  for (const p of VALUE_PATTERNS) out = out.replace(p, "[REDACTED]");
  return out.replace(KV_PATTERN, (_m, key, sep) => `${key}${sep}[REDACTED]`);
}

/** Recursively replace sensitive header/field values with [REDACTED] and scrub
 *  secret-shaped substrings inside string values. Shared by backend + extension. */
export function redactSensitiveData<T>(input: T): T {
  if (typeof input === "string") return redactText(input) as unknown as T;
  if (Array.isArray(input)) return input.map((v) => redactSensitiveData(v)) as unknown as T;
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? "[REDACTED]" : redactSensitiveData(v);
    }
    return out as T;
  }
  return input;
}
