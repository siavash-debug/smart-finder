import { describe, expect, it } from "vitest";

import { evaluateArea } from "./area.js";

describe("evaluateArea", () => {
  it("is not_applicable when no area preference is stated", () => {
    const { criterion, violation } = evaluateArea(null, null, 125);
    expect(criterion.status).toBe("not_applicable");
    expect(violation).toBeNull();
  });

  it("matches exactly at the minimum boundary", () => {
    const { criterion, violation } = evaluateArea(100, null, 100);
    expect(criterion.status).toBe("matched");
    expect(violation).toBeNull();
  });

  it("matches a value within [min, max]", () => {
    const { criterion } = evaluateArea(100, 150, 125);
    expect(criterion.status).toBe("matched");
  });

  it("is a hard violation below the minimum", () => {
    const { criterion, violation } = evaluateArea(100, null, 95);
    expect(criterion.status).toBe("mismatch");
    expect(violation).toMatchObject({ key: "area", severity: "hard" });
  });

  it("is a hard violation above the maximum", () => {
    const { criterion, violation } = evaluateArea(null, 150, 160);
    expect(criterion.status).toBe("mismatch");
    expect(violation).toMatchObject({ key: "area", severity: "hard" });
  });

  it("is unknown, not a violation, when the listing area is unknown", () => {
    const { criterion, violation } = evaluateArea(100, 150, null);
    expect(criterion.status).toBe("unknown");
    expect(violation).toBeNull();
  });

  it("125 sqm against a minimum of 100 must not fail (adversarial case)", () => {
    const { criterion, violation } = evaluateArea(100, null, 125);
    expect(criterion.status).toBe("matched");
    expect(violation).toBeNull();
  });
});
