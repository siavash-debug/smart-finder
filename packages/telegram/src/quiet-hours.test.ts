import { describe, expect, it } from "vitest";

import { isWithinQuietHours, nextAllowedSendTime } from "./quiet-hours.js";

// Tehran has used a fixed UTC+03:30 offset (no DST) since 2022, so these UTC instants map
// predictably to Tehran local time for test fixtures. The implementation itself never
// hard-codes this offset — see quiet-hours.ts's `offsetMinutesAt`.
describe("isWithinQuietHours", () => {
  it("is false at Tehran 15:30 (well within the day)", () => {
    expect(isWithinQuietHours(new Date("2026-09-07T12:00:00.000Z"))).toBe(false);
  });

  it("is true at Tehran 23:30 (just after quiet hours start)", () => {
    expect(isWithinQuietHours(new Date("2026-09-07T20:00:00.000Z"))).toBe(true);
  });

  it("is true at Tehran 06:30 (before quiet hours end)", () => {
    expect(isWithinQuietHours(new Date("2026-09-07T03:00:00.000Z"))).toBe(true);
  });

  it("is false at Tehran 08:30 (just after quiet hours end)", () => {
    expect(isWithinQuietHours(new Date("2026-09-07T05:00:00.000Z"))).toBe(false);
  });

  it("is true at exactly Tehran 23:00 (inclusive start boundary)", () => {
    expect(isWithinQuietHours(new Date("2026-09-07T19:30:00.000Z"))).toBe(true);
  });

  it("is false at exactly Tehran 08:00 (exclusive end boundary)", () => {
    expect(isWithinQuietHours(new Date("2026-09-07T04:30:00.000Z"))).toBe(false);
  });

  it("is deterministic for repeated identical calls", () => {
    const now = new Date("2026-09-07T20:00:00.000Z");
    const results = Array.from({ length: 5 }, () => isWithinQuietHours(now));
    expect(new Set(results).size).toBe(1);
  });
});

describe("nextAllowedSendTime", () => {
  it("is null when it's not currently quiet hours", () => {
    expect(nextAllowedSendTime(new Date("2026-09-07T12:00:00.000Z"))).toBeNull();
  });

  it("defers to the same day's 08:00 Tehran when queried before that time", () => {
    // 2026-09-07T03:00Z = Tehran 06:30 on the 7th; next 08:00 Tehran is later the same day.
    const result = nextAllowedSendTime(new Date("2026-09-07T03:00:00.000Z"));
    expect(result).toEqual(new Date("2026-09-07T04:30:00.000Z"));
  });

  it("defers to the next day's 08:00 Tehran when queried after 23:00", () => {
    // 2026-09-07T20:00Z = Tehran 23:30 on the 7th; next 08:00 Tehran is the 8th.
    const result = nextAllowedSendTime(new Date("2026-09-07T20:00:00.000Z"));
    expect(result).toEqual(new Date("2026-09-08T04:30:00.000Z"));
  });

  it("the deferred time itself is never within quiet hours", () => {
    const deferred = nextAllowedSendTime(new Date("2026-09-07T20:00:00.000Z"));
    expect(deferred).not.toBeNull();
    expect(isWithinQuietHours(deferred!)).toBe(false);
  });

  it("is deterministic for repeated identical calls", () => {
    const now = new Date("2026-09-07T20:00:00.000Z");
    const results = Array.from({ length: 5 }, () => nextAllowedSendTime(now)?.getTime());
    expect(new Set(results).size).toBe(1);
  });
});
