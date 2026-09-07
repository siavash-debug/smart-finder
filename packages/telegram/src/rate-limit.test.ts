import { describe, expect, it } from "vitest";

import { checkRateLimit, COMMAND_RATE_LIMIT, type RateLimitPolicy } from "./rate-limit.js";

const POLICY: RateLimitPolicy = { windowMs: 60_000, maxEvents: 3 };
const NOW = new Date("2026-09-07T12:00:00.000Z");

function secondsAgo(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000);
}

describe("checkRateLimit", () => {
  it("allows a request with no prior events", () => {
    expect(checkRateLimit([], NOW, POLICY)).toEqual({ limited: false, countInWindow: 0 });
  });

  it("allows a request when under the limit", () => {
    const events = [secondsAgo(10), secondsAgo(20)];
    expect(checkRateLimit(events, NOW, POLICY)).toEqual({ limited: false, countInWindow: 2 });
  });

  it("limits a request once maxEvents is reached within the window", () => {
    const events = [secondsAgo(5), secondsAgo(10), secondsAgo(15)];
    expect(checkRateLimit(events, NOW, POLICY)).toEqual({ limited: true, countInWindow: 3 });
  });

  it("ignores events outside the window", () => {
    const events = [secondsAgo(5), secondsAgo(120), secondsAgo(300)];
    expect(checkRateLimit(events, NOW, POLICY)).toEqual({ limited: false, countInWindow: 1 });
  });

  it("treats an event exactly at the window boundary as inside the window", () => {
    const events = [secondsAgo(60)];
    expect(checkRateLimit(events, NOW, POLICY).countInWindow).toBe(1);
  });

  it("a legitimate request still succeeds when well under the limit", () => {
    expect(checkRateLimit([secondsAgo(1)], NOW, COMMAND_RATE_LIMIT).limited).toBe(false);
  });

  it("is deterministic for repeated identical inputs", () => {
    const events = [secondsAgo(1), secondsAgo(2), secondsAgo(3)];
    const results = Array.from({ length: 5 }, () => checkRateLimit(events, NOW, POLICY));
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  it("repeated requests eventually get limited as the window fills", () => {
    const events: Date[] = [];
    const decisions: boolean[] = [];
    for (let i = 0; i < 5; i += 1) {
      const at = secondsAgo(30 - i);
      decisions.push(checkRateLimit(events, at, POLICY).limited);
      events.push(at);
    }
    expect(decisions).toEqual([false, false, false, true, true]);
  });
});
