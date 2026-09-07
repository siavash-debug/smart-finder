import { describe, expect, it } from "vitest";

import { evaluateDistrict, evaluateNeighborhood } from "./location.js";

describe("evaluateDistrict", () => {
  it("is not_applicable when no district preference is stated", () => {
    const { criterion, violation } = evaluateDistrict(null, "district-2");
    expect(criterion.status).toBe("not_applicable");
    expect(violation).toBeNull();
  });

  it("matches the exact requested district", () => {
    const { criterion, violation } = evaluateDistrict("district-2", "district-2");
    expect(criterion.status).toBe("matched");
    expect(violation).toBeNull();
  });

  it("is a HARD violation for a different district", () => {
    const { criterion, violation } = evaluateDistrict("district-5", "district-2");
    expect(criterion.status).toBe("mismatch");
    expect(violation).toMatchObject({ key: "district", severity: "hard" });
  });

  it("is unknown, not a violation, when the listing's district is unknown", () => {
    const { criterion, violation } = evaluateDistrict("district-2", null);
    expect(criterion.status).toBe("unknown");
    expect(violation).toBeNull();
  });

  it("a different-district listing must never become exact (adversarial)", () => {
    const { violation } = evaluateDistrict("district-5", "district-2");
    expect(violation?.severity).toBe("hard");
  });
});

describe("evaluateNeighborhood", () => {
  it("is not_applicable when no neighborhood preference is stated", () => {
    const { criterion, violation } = evaluateNeighborhood(null, "neighborhood-a");
    expect(criterion.status).toBe("not_applicable");
    expect(violation).toBeNull();
  });

  it("matches the exact requested neighborhood", () => {
    const { criterion, violation } = evaluateNeighborhood("neighborhood-a", "neighborhood-a");
    expect(criterion.status).toBe("matched");
    expect(violation).toBeNull();
  });

  it("is a SOFT violation for a different neighborhood (same or different district)", () => {
    const { criterion, violation } = evaluateNeighborhood("neighborhood-a", "neighborhood-b");
    expect(criterion.status).toBe("mismatch");
    expect(violation).toMatchObject({ key: "neighborhood", severity: "soft" });
  });

  it("is unknown, not a violation, when the listing's neighborhood is unknown", () => {
    const { criterion, violation } = evaluateNeighborhood("neighborhood-a", null);
    expect(criterion.status).toBe("unknown");
    expect(violation).toBeNull();
  });

  it("a neighborhood mismatch is soft, so it never blocks the hard-constraint gate by itself", () => {
    const { violation } = evaluateNeighborhood("neighborhood-a", "neighborhood-b");
    expect(violation?.severity).toBe("soft");
  });
});
