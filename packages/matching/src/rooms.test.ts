import { describe, expect, it } from "vitest";

import { evaluateRooms } from "./rooms.js";

describe("evaluateRooms", () => {
  it("is not_applicable when no bedroom preference is stated", () => {
    const { criterion, violation } = evaluateRooms(null, null, 2);
    expect(criterion.status).toBe("not_applicable");
    expect(violation).toBeNull();
  });

  it("matches an exact request (min === max)", () => {
    const { criterion, violation } = evaluateRooms(2, 2, 2);
    expect(criterion.status).toBe("matched");
    expect(violation).toBeNull();
  });

  it("is a hard violation for an exact mismatch", () => {
    const { criterion, violation } = evaluateRooms(2, 2, 3);
    expect(criterion.status).toBe("mismatch");
    expect(violation).toMatchObject({ key: "rooms", severity: "hard" });
  });

  it("matches within a min/max range", () => {
    const { criterion } = evaluateRooms(2, 3, 3);
    expect(criterion.status).toBe("matched");
  });

  it("is unknown, not a violation, when the listing room count is unknown", () => {
    const { criterion, violation } = evaluateRooms(2, 2, null);
    expect(criterion.status).toBe("unknown");
    expect(violation).toBeNull();
  });

  it("a 3-bedroom requirement is not satisfied by an otherwise-excellent 2-bedroom listing", () => {
    // Adversarial: this criterion must fail on its own regardless of any other field.
    const { criterion, violation } = evaluateRooms(3, 3, 2);
    expect(criterion.status).toBe("mismatch");
    expect(violation?.severity).toBe("hard");
  });
});
