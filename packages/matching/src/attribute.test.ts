import { describe, expect, it } from "vitest";

import { evaluateAttribute } from "./attribute.js";

describe("evaluateAttribute", () => {
  it("required=true, actual=true → matched", () => {
    const { criterion, violation } = evaluateAttribute("parking", "parking", true, true);
    expect(criterion.status).toBe("matched");
    expect(violation).toBeNull();
  });

  it("required=true, actual=false → hard violation", () => {
    const { criterion, violation } = evaluateAttribute("parking", "parking", true, false);
    expect(criterion.status).toBe("mismatch");
    expect(violation).toMatchObject({ key: "parking", severity: "hard" });
  });

  it("required=true, actual=unknown → unknown, never coerced to false", () => {
    const { criterion, violation } = evaluateAttribute("parking", "parking", true, null);
    expect(criterion.status).toBe("unknown");
    expect(violation).toBeNull();
    expect(criterion.actual).toBeUndefined();
  });

  it("required=false, actual=false → matched", () => {
    const { criterion, violation } = evaluateAttribute("parking", "parking", false, false);
    expect(criterion.status).toBe("matched");
    expect(violation).toBeNull();
  });

  it("required=false, actual=true → hard violation", () => {
    const { criterion, violation } = evaluateAttribute("parking", "parking", false, true);
    expect(criterion.status).toBe("mismatch");
    expect(violation).toMatchObject({ key: "parking", severity: "hard" });
  });

  it("required=false, actual=unknown → unknown", () => {
    const { criterion, violation } = evaluateAttribute("parking", "parking", false, null);
    expect(criterion.status).toBe("unknown");
    expect(violation).toBeNull();
  });

  it("not requested (null) → not_applicable, regardless of the listing's actual value", () => {
    for (const actual of [true, false, null] as const) {
      const { criterion, violation } = evaluateAttribute("parking", "parking", null, actual);
      expect(criterion.status).toBe("not_applicable");
      expect(violation).toBeNull();
    }
  });

  it("not requested is never treated as required-false", () => {
    // If "not requested" collapsed to "required false", a listing WITH parking would
    // wrongly become a violation. It must not.
    const { criterion, violation } = evaluateAttribute("parking", "parking", null, true);
    expect(criterion.status).toBe("not_applicable");
    expect(violation).toBeNull();
  });

  it("works identically for elevator and storage keys", () => {
    expect(evaluateAttribute("elevator", "elevator", true, false).violation).toMatchObject({
      key: "elevator",
      severity: "hard",
    });
    expect(evaluateAttribute("storage", "storage", true, null).criterion.status).toBe("unknown");
  });
});
