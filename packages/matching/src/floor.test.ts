import { describe, expect, it } from "vitest";

import { evaluateFloor } from "./floor.js";

describe("evaluateFloor", () => {
  it("is not_applicable when no floor preference is stated and floor is numeric", () => {
    const { criterion, violation } = evaluateFloor(null, null, 3, null);
    expect(criterion.status).toBe("not_applicable");
    expect(violation).toBeNull();
  });

  it("matches a numeric floor within range", () => {
    const { criterion, violation } = evaluateFloor(1, 5, 3, null);
    expect(criterion.status).toBe("matched");
    expect(violation).toBeNull();
  });

  it("is a SOFT violation below the minimum", () => {
    const { criterion, violation } = evaluateFloor(2, null, 1, null);
    expect(criterion.status).toBe("mismatch");
    expect(violation).toMatchObject({ key: "floor", severity: "soft" });
  });

  it("is a SOFT violation above the maximum", () => {
    const { criterion, violation } = evaluateFloor(null, 5, 8, null);
    expect(criterion.status).toBe("mismatch");
    expect(violation).toMatchObject({ key: "floor", severity: "soft" });
  });

  it("is unknown when the numeric floor is unknown and no category is given", () => {
    const { criterion, violation } = evaluateFloor(2, 5, null, null);
    expect(criterion.status).toBe("unknown");
    expect(violation).toBeNull();
  });

  describe("special categories", () => {
    it("is not_applicable for a ground-floor listing when no floor preference is stated", () => {
      const { criterion, violation } = evaluateFloor(null, null, null, "ground");
      expect(criterion.status).toBe("not_applicable");
      expect(violation).toBeNull();
    });

    it("is unknown — never coerced to floor 0 — for a ground-floor listing against a numeric range", () => {
      const { criterion, violation } = evaluateFloor(2, null, null, "ground");
      expect(criterion.status).toBe("unknown");
      expect(criterion.actual).toBe("ground");
      expect(violation).toBeNull();
    });

    it("is unknown — never coerced to floor -1 — for a basement listing against a numeric range", () => {
      const { criterion, violation } = evaluateFloor(1, 5, null, "basement");
      expect(criterion.status).toBe("unknown");
      expect(criterion.actual).toBe("basement");
      expect(violation).toBeNull();
    });

    it("is unknown for a penthouse listing against a numeric range", () => {
      const { criterion, violation } = evaluateFloor(1, 10, null, "penthouse");
      expect(criterion.status).toBe("unknown");
      expect(violation).toBeNull();
    });

    it("never produces a violation for a category floor, regardless of the requested range", () => {
      const results = (["ground", "basement", "penthouse"] as const).map(
        (category) => evaluateFloor(5, 8, null, category).violation,
      );
      expect(results).toEqual([null, null, null]);
    });
  });
});
