import { describe, test, expect } from "bun:test";
import { redactSensitiveData, redactText } from "./redaction.js";

describe("redactSensitiveData (key-based)", () => {
  test("redacts sensitive keys at any depth", () => {
    const r = redactSensitiveData({
      authorization: "Bearer x",
      nested: { cookie: "a=b", ok: 1 },
      list: [{ token: "t" }, { fine: "keep" }],
    }) as any;
    expect(r.authorization).toBe("[REDACTED]");
    expect(r.nested.cookie).toBe("[REDACTED]");
    expect(r.list[0].token).toBe("[REDACTED]");
    expect(r.list[1].fine).toBe("keep");
    expect(r.nested.ok).toBe(1);
  });

  test("matches key variants case-insensitively and as substrings", () => {
    const r = redactSensitiveData({
      "X-API-KEY": "k",
      Set_Cookie: "c",
      myAccess_Token: "t",
      csrfToken: "x",
      PRIVATE_KEY: "p",
    }) as any;
    for (const v of Object.values(r)) expect(v).toBe("[REDACTED]");
  });

  test("does not touch non-sensitive keys or non-string primitives", () => {
    const r = redactSensitiveData({ count: 3, flag: true, none: null, name: "alice" }) as any;
    expect(r).toEqual({ count: 3, flag: true, none: null, name: "alice" });
  });

  test("handles primitives, null, and empty containers", () => {
    expect(redactSensitiveData(null)).toBe(null);
    expect(redactSensitiveData(42)).toBe(42);
    expect(redactSensitiveData([])).toEqual([]);
    expect(redactSensitiveData({})).toEqual({});
  });

  test("scrubs secret-shaped substrings inside string values", () => {
    const r = redactSensitiveData({ message: "failed with api_key=abc123secret" }) as any;
    expect(r.message).toBe("failed with api_key=[REDACTED]");
  });
});

describe("redactText (free-text scrubbing)", () => {
  test("Bearer tokens", () => {
    expect(redactText("authorization: Bearer abcDEF123456789xyz done"))
      .toContain("[REDACTED]");
    expect(redactText("Bearer abcDEF123456789xyz")).not.toContain("abcDEF");
  });

  test("JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM";
    expect(redactText(`token in page: ${jwt}`)).not.toContain("eyJhbGci");
  });

  test("sk- style API keys", () => {
    expect(redactText("using sk-0000000000000000000000000000000f here")).not.toContain("sk-0000");
  });

  test("key:value and key=value pairs, quoted and bare", () => {
    expect(redactText("password=hunter22")).toBe("password=[REDACTED]");
    expect(redactText('api_key: "abc-123-def"')).toBe("api_key: [REDACTED]");
    expect(redactText("refresh_token = 'zzz111'")).toBe("refresh_token = [REDACTED]");
    expect(redactText("CSRF: deadbeef99")).toBe("CSRF: [REDACTED]");
  });

  test("leaves normal prose untouched", () => {
    const s = "The user clicked the Buy button and the page reloaded. Total: $19.99";
    expect(redactText(s)).toBe(s);
  });

  test("skips huge strings (screenshot base64) instead of regex-scanning them", () => {
    const huge = "sk-" + "A".repeat(200_000);
    const start = performance.now();
    expect(redactText(huge)).toBe(huge); // returned untouched, instantly
    expect(performance.now() - start).toBeLessThan(50);
  });
});
