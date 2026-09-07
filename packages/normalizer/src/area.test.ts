import { describe, expect, it } from "vitest";

import { parseArea } from "./area.js";

describe("parseArea", () => {
  it("parses Persian digits with متر", () => {
    expect(parseArea("۱۲۵ متر")).toMatchObject({
      kind: "exact",
      sqm: 125,
      approximate: false,
      comparator: null,
    });
  });

  it("parses Latin digits with متر", () => {
    expect(parseArea("125 متر")).toMatchObject({ kind: "exact", sqm: 125 });
  });

  it("parses متری as a unit suffix", () => {
    expect(parseArea("۱۲۵ متری")).toMatchObject({ kind: "exact", sqm: 125 });
  });

  it("parses the Latin m suffix glued to the digits", () => {
    expect(parseArea("۱۲۵m")).toMatchObject({ kind: "exact", sqm: 125 });
  });

  it("parses sqm and m2 suffixes", () => {
    expect(parseArea("125 sqm")).toMatchObject({ kind: "exact", sqm: 125 });
    expect(parseArea("125 m2")).toMatchObject({ kind: "exact", sqm: 125 });
  });

  it("recognizes حدود as approximate without changing the value", () => {
    expect(parseArea("حدود ۱۲۵ متر")).toMatchObject({
      kind: "exact",
      sqm: 125,
      approximate: true,
    });
  });

  it("recognizes نزدیک and تقریبا as approximate", () => {
    expect(parseArea("نزدیک ۱۲۵ متر")).toMatchObject({ approximate: true });
    expect(parseArea("تقریبا ۱۲۵ متر")).toMatchObject({ approximate: true });
  });

  it("recognizes بیشتر از as an at-least comparator", () => {
    expect(parseArea("بیشتر از ۱۰۰ متر")).toMatchObject({
      kind: "exact",
      sqm: 100,
      comparator: "at_least",
    });
  });

  it("recognizes کمتر از as an at-most comparator", () => {
    expect(parseArea("کمتر از ۱۰۰ متر")).toMatchObject({
      kind: "exact",
      sqm: 100,
      comparator: "at_most",
    });
  });

  it("returns unknown for a bare number with no unit — too ambiguous to guess", () => {
    expect(parseArea("۱۲۵")).toEqual({ kind: "unknown", sourceText: "۱۲۵" });
  });

  it("returns unknown for malformed input", () => {
    expect(parseArea("متر ۱۲۵ متر")).toEqual({ kind: "unknown", sourceText: "متر ۱۲۵ متر" });
    expect(parseArea("")).toEqual({ kind: "unknown", sourceText: "" });
  });

  it("returns unknown for a decimal area rather than inventing sub-meter precision", () => {
    expect(parseArea("125.5 متر")).toEqual({ kind: "unknown", sourceText: "125.5 متر" });
  });

  it("returns unknown for zero or negative area", () => {
    expect(parseArea("0 متر")).toEqual({ kind: "unknown", sourceText: "0 متر" });
  });

  it("preserves the original source text verbatim", () => {
    const input = "  ۱۲۵ متر  ";
    expect(parseArea(input).sourceText).toBe(input);
  });

  it("does not confuse a room count for an area", () => {
    // A number followed by anything other than a recognized area unit is not an area.
    expect(parseArea("۲ خواب")).toEqual({ kind: "unknown", sourceText: "۲ خواب" });
  });
});
