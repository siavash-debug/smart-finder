import { describe, expect, it } from "vitest";

import { classifyTier } from "./tier.js";
import type { MatchCriterion } from "./types.js";

function criterion(status: MatchCriterion["status"]): MatchCriterion {
  return { key: "test", status, explanation: "test" };
}

describe("classifyTier", () => {
  it("is exact when everything matched or was not applicable", () => {
    const criteria = [criterion("matched"), criterion("matched"), criterion("not_applicable")];
    expect(classifyTier(false, criteria)).toBe("exact");
  });

  it("is exact for an empty criteria list (nothing requested, nothing violated)", () => {
    expect(classifyTier(false, [])).toBe("exact");
  });

  it("is strong with a single unknown", () => {
    const criteria = [criterion("matched"), criterion("unknown")];
    expect(classifyTier(false, criteria)).toBe("strong");
  });

  it("is strong with two unknowns", () => {
    const criteria = [criterion("unknown"), criterion("unknown")];
    expect(classifyTier(false, criteria)).toBe("strong");
  });

  it("is strong with a single soft mismatch", () => {
    const criteria = [criterion("mismatch")];
    expect(classifyTier(false, criteria)).toBe("strong");
  });

  it("is near with three unknowns", () => {
    const criteria = [criterion("unknown"), criterion("unknown"), criterion("unknown")];
    expect(classifyTier(false, criteria)).toBe("near");
  });

  it("is near with two soft mismatches", () => {
    const criteria = [criterion("mismatch"), criterion("mismatch")];
    expect(classifyTier(false, criteria)).toBe("near");
  });

  it("is near whenever there is a confirmed hard violation, regardless of everything else matching", () => {
    const criteria = [criterion("matched"), criterion("matched"), criterion("matched")];
    expect(classifyTier(true, criteria)).toBe("near");
  });

  it("hard violation dominance: cannot become exact even with zero soft deviation", () => {
    expect(classifyTier(true, [])).toBe("near");
  });

  it("hard violation dominance: cannot become strong even with otherwise-perfect criteria", () => {
    const criteria = Array.from({ length: 10 }, () => criterion("matched"));
    expect(classifyTier(true, criteria)).not.toBe("strong");
    expect(classifyTier(true, criteria)).not.toBe("exact");
  });

  it("is deterministic for repeated identical calls", () => {
    const criteria = [criterion("matched"), criterion("unknown")];
    const results = Array.from({ length: 5 }, () => classifyTier(false, criteria));
    expect(new Set(results).size).toBe(1);
  });
});
