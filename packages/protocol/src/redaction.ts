const SENSITIVE = [
  "authorization", "cookie", "set-cookie", "x-api-key", "x-shopify-access-token",
  "api_key", "access_token", "refresh_token", "password", "secret",
  "private_key", "csrf", "token",
];

const isSensitiveKey = (key: string) => {
  const k = key.toLowerCase();
  return SENSITIVE.some((s) => k.includes(s));
};

/** Recursively replace sensitive header/field values with [REDACTED]. Shared by backend + extension. */
export function redactSensitiveData<T>(input: T): T {
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
