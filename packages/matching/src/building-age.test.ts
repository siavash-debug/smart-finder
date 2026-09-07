import { describe, expect, it } from "vitest";

import { evaluateBuildingAge } from "./building-age.js";

describe("evaluateBuildingAge", () => {
  it("is not_applicable when no age preference is stated", () => {
    const { criterion, violation } = evaluateBuildingAge(null, null, 5);
    expect(criterion.status).toBe("not_applicable");
    expect(violation).toBeNull();
  });

  it("matches within range", () => {
    const { criterion, violation } = evaluateBuildingAge(0, 10, 5);
    expect(criterion.status).toBe("matched");
    expect(violation).toBeNull();
  });

  it("is a SOFT violation when older than the requested maximum age", () => {
    const { criterion, violation } = evaluateBuildingAge(0, 5, 10);
    expect(criterion.status).toBe("mismatch");
    expect(violation).toMatchObject({ key: "building_age", severity: "soft" });
  });

  it("is a SOFT violation when newer than the requested minimum age", () => {
    const { criterion, violation } = evaluateBuildingAge(5, null, 1);
    expect(criterion.status).toBe("mismatch");
    expect(violation).toMatchObject({ key: "building_age", severity: "soft" });
  });

  it("is unknown, not a violation, when the listing's age is unknown", () => {
    const { criterion, violation } = evaluateBuildingAge(0, 5, null);
    expect(criterion.status).toBe("unknown");
    expect(violation).toBeNull();
  });

  it("matches a brand-new-construction preference (max age 0-1)", () => {
    const { criterion } = evaluateBuildingAge(null, 1, 0);
    expect(criterion.status).toBe("matched");
  });
});
