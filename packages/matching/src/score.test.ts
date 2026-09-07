import { describe, expect, it } from "vitest";

import {
  calculateScore,
  HARD_VIOLATION_PENALTY,
  SOFT_MISMATCH_PENALTY,
  UNKNOWN_PENALTY,
} from "./score.js";
import type { MatchCriterion, MatchViolation } from "./types.js";

function criterion(status: MatchCriterion["status"]): MatchCriterion {
  return { key: "test", status, explanation: "test" };
}

function violation(severity: MatchViolation["severity"]): MatchViolation {
  return { key: "test", severity, reason: "test" };
}

describe("calculateScore", () => {
  it("is 100 with nothing to penalize", () => {
    expect(calculateScore([], [])).toBe(100);
    expect(calculateScore([], [criterion("matched"), criterion("not_applicable")])).toBe(100);
  });

  it("subtracts the unknown penalty per unknown criterion", () => {
    expect(calculateScore([], [criterion("unknown")])).toBe(100 - UNKNOWN_PENALTY);
    expect(calculateScore([], [criterion("unknown"), criterion("unknown")])).toBe(
      100 - 2 * UNKNOWN_PENALTY,
    );
  });

  it("subtracts the soft-mismatch penalty per soft violation", () => {
    expect(calculateScore([violation("soft")], [criterion("mismatch")])).toBe(
      100 - SOFT_MISMATCH_PENALTY,
    );
  });

  it("subtracts the hard-violation penalty per hard violation", () => {
    expect(calculateScore([violation("hard")], [criterion("mismatch")])).toBe(
      100 - HARD_VIOLATION_PENALTY,
    );
  });

  it("does not double-count a mismatch already represented as a violation", () => {
    // One soft mismatch = one soft violation + one "mismatch"-status criterion. The
    // criterion loop must not also penalize it as if it were "unknown".
    const score = calculateScore([violation("soft")], [criterion("mismatch")]);
    expect(score).toBe(100 - SOFT_MISMATCH_PENALTY);
  });

  it("is bounded below at 0 with many violations", () => {
    const violations = Array.from({ length: 10 }, () => violation("hard"));
    expect(calculateScore(violations, [])).toBe(0);
  });

  it("is always within [0, 100]", () => {
    const cases = [
      { violations: [], criteria: [] },
      { violations: Array.from({ length: 20 }, () => violation("hard")), criteria: [] },
      { violations: [], criteria: Array.from({ length: 50 }, () => criterion("unknown")) },
    ];
    for (const { violations, criteria } of cases) {
      const total = calculateScore(violations, criteria);
      expect(total).toBeGreaterThanOrEqual(0);
      expect(total).toBeLessThanOrEqual(100);
      expect(Number.isInteger(total)).toBe(true);
    }
  });

  it("is deterministic for repeated identical calls", () => {
    const violations = [violation("hard"), violation("soft")];
    const criteria = [criterion("unknown"), criterion("matched")];
    const results = Array.from({ length: 5 }, () => calculateScore(violations, criteria));
    expect(new Set(results).size).toBe(1);
  });

  it("multiple hard violations reduce the score further than one", () => {
    const one = calculateScore([violation("hard")], []);
    const two = calculateScore([violation("hard"), violation("hard")], []);
    expect(two).toBeLessThan(one);
  });
});
