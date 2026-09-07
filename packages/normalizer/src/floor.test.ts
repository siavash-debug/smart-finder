import { describe, expect, it } from "vitest";

import { parseFloor } from "./floor.js";

describe("parseFloor", () => {
  it("parses a numeric floor with طبقه prefix", () => {
    expect(parseFloor("طبقه ۳")).toEqual({
      kind: "numeric",
      floor: 3,
      totalFloors: null,
      sourceText: "طبقه ۳",
    });
  });

  it("parses an ordinal word floor", () => {
    expect(parseFloor("طبقه سوم")).toEqual({
      kind: "numeric",
      floor: 3,
      totalFloors: null,
      sourceText: "طبقه سوم",
    });
  });

  it("parses floor-from-total without the طبقه prefix", () => {
    expect(parseFloor("۳ از ۵")).toEqual({
      kind: "numeric",
      floor: 3,
      totalFloors: 5,
      sourceText: "۳ از ۵",
    });
  });

  it("parses floor-from-total with the طبقه prefix", () => {
    expect(parseFloor("طبقه ۳ از ۵")).toEqual({
      kind: "numeric",
      floor: 3,
      totalFloors: 5,
      sourceText: "طبقه ۳ از ۵",
    });
  });

  it("parses ordinal floor-from-total", () => {
    expect(parseFloor("طبقه اول از ۴")).toEqual({
      kind: "numeric",
      floor: 1,
      totalFloors: 4,
      sourceText: "طبقه اول از ۴",
    });
  });

  it("parses همکف as a category, not floor zero", () => {
    expect(parseFloor("همکف")).toEqual({
      kind: "category",
      category: "ground",
      sourceText: "همکف",
    });
  });

  it("parses زیرزمین as a category, not floor -1", () => {
    expect(parseFloor("زیرزمین")).toEqual({
      kind: "category",
      category: "basement",
      sourceText: "زیرزمین",
    });
  });

  it("parses پنت‌هاوس (with ZWNJ) as the penthouse category", () => {
    const zwnj = String.fromCharCode(0x200c);
    expect(parseFloor(`پنت${zwnj}هاوس`)).toMatchObject({ kind: "category", category: "penthouse" });
  });

  it("parses a bare numeric floor with no طبقه prefix", () => {
    expect(parseFloor("۳")).toEqual({
      kind: "numeric",
      floor: 3,
      totalFloors: null,
      sourceText: "۳",
    });
  });

  it("does not map a category to an arbitrary numeric floor", () => {
    const result = parseFloor("همکف");
    expect(result.kind).toBe("category");
    expect(result).not.toHaveProperty("floor");
  });

  it("returns unknown for empty input or طبقه with nothing after it", () => {
    expect(parseFloor("")).toEqual({ kind: "unknown", sourceText: "" });
    expect(parseFloor("طبقه")).toEqual({ kind: "unknown", sourceText: "طبقه" });
  });

  it("returns unknown for an unrecognized ordinal-like word", () => {
    expect(parseFloor("طبقه بیست و یکم")).toEqual({
      kind: "unknown",
      sourceText: "طبقه بیست و یکم",
    });
  });

  it("preserves the original source text verbatim", () => {
    const input = "  طبقه ۳  ";
    expect(parseFloor(input).sourceText).toBe(input);
  });
});
