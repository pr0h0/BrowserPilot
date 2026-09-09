import { describe, test, expect, beforeEach } from "bun:test";
import { isLockedOut, recordAuthFailure, clearAuthFailures, _resetRateLimit } from "./rateLimit.js";

describe("auth throttle", () => {
  beforeEach(() => _resetRateLimit());

  test("locks out after repeated failures from one IP", () => {
    for (let i = 0; i < 9; i++) recordAuthFailure("1.2.3.4");
    expect(isLockedOut("1.2.3.4")).toBe(false);
    recordAuthFailure("1.2.3.4");
    expect(isLockedOut("1.2.3.4")).toBe(true);
    expect(isLockedOut("5.6.7.8")).toBe(false); // per-IP, not global
  });

  test("a success clears the counter", () => {
    for (let i = 0; i < 10; i++) recordAuthFailure("1.2.3.4");
    clearAuthFailures("1.2.3.4");
    expect(isLockedOut("1.2.3.4")).toBe(false);
  });

  test("the window expires", () => {
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) recordAuthFailure("1.2.3.4", t0);
    expect(isLockedOut("1.2.3.4", t0 + 60_000)).toBe(true);
    expect(isLockedOut("1.2.3.4", t0 + 16 * 60_000)).toBe(false);
  });
});
