import { describe, expect, it } from "vitest";

import { evaluateBudget } from "./budget.js";

describe("evaluateBudget", () => {
  it("is not_applicable when no budget is stated", () => {
    const { criterion, violation } = evaluateBudget(null, null, 5_000_000_000n);
    expect(criterion.status).toBe("not_applicable");
    expect(violation).toBeNull();
  });

  it("matches exactly at the maximum boundary", () => {
    const { criterion, violation } = evaluateBudget(null, 6_000_000_000n, 6_000_000_000n);
    expect(criterion.status).toBe("matched");
    expect(violation).toBeNull();
  });

  it("matches below the maximum", () => {
    const { criterion, violation } = evaluateBudget(null, 6_000_000_000n, 5_500_000_000n);
    expect(criterion.status).toBe("matched");
    expect(violation).toBeNull();
  });

  it("is a hard violation above the maximum", () => {
    const { criterion, violation } = evaluateBudget(null, 6_000_000_000n, 6_500_000_000n);
    expect(criterion.status).toBe("mismatch");
    expect(violation).toMatchObject({ key: "budget", severity: "hard" });
  });

  it("matches exactly at the minimum boundary", () => {
    const { criterion, violation } = evaluateBudget(5_000_000_000n, null, 5_000_000_000n);
    expect(criterion.status).toBe("matched");
    expect(violation).toBeNull();
  });

  it("is a hard violation below the minimum", () => {
    const { criterion, violation } = evaluateBudget(5_000_000_000n, null, 4_000_000_000n);
    expect(criterion.status).toBe("mismatch");
    expect(violation).toMatchObject({ key: "budget", severity: "hard" });
  });

  it("is unknown, not a violation, when the listing price is unknown", () => {
    const { criterion, violation } = evaluateBudget(null, 6_000_000_000n, null);
    expect(criterion.status).toBe("unknown");
    expect(violation).toBeNull();
  });

  it("uses exact bigint arithmetic at a boundary many orders of magnitude apart", () => {
    // If this were floating point, a huge Toman figure combined with a tiny one could drift.
    const max = 15_000_000_000_000n;
    const { criterion, violation } = evaluateBudget(null, max, max);
    expect(criterion.status).toBe("matched");
    expect(violation).toBeNull();
  });

  it("matches within a full min/max range", () => {
    const { criterion } = evaluateBudget(5_000_000_000n, 6_000_000_000n, 5_500_000_000n);
    expect(criterion.status).toBe("matched");
  });

  it("does not mutate any of its arguments", () => {
    const min = 5_000_000_000n;
    const max = 6_000_000_000n;
    const actual = 5_500_000_000n;
    evaluateBudget(min, max, actual);
    expect(min).toBe(5_000_000_000n);
    expect(max).toBe(6_000_000_000n);
    expect(actual).toBe(5_500_000_000n);
  });
});
