import { describe, expect, it } from "vitest";

import { parseBuildingAge } from "./building-age.js";

describe("parseBuildingAge", () => {
  it("parses ساخت YEAR", () => {
    expect(parseBuildingAge("ساخت ۱۴۰۲")).toEqual({
      kind: "year",
      jalaliYear: 1402,
      sourceText: "ساخت ۱۴۰۲",
    });
  });

  it("parses سال ساخت YEAR", () => {
    expect(parseBuildingAge("سال ساخت ۱۴۰۲")).toEqual({
      kind: "year",
      jalaliYear: 1402,
      sourceText: "سال ساخت ۱۴۰۲",
    });
  });

  it("parses نوساز as new construction, not a specific year", () => {
    expect(parseBuildingAge("نوساز")).toEqual({ kind: "new_construction", sourceText: "نوساز" });
  });

  it("parses کلیدنخورده as new construction", () => {
    expect(parseBuildingAge("کلیدنخورده")).toEqual({
      kind: "new_construction",
      sourceText: "کلیدنخورده",
    });
  });

  it("parses relative age without inventing an absolute year", () => {
    const result = parseBuildingAge("۵ ساله");
    expect(result).toEqual({ kind: "relative_age", years: 5, sourceText: "۵ ساله" });
    expect(result).not.toHaveProperty("jalaliYear");
  });

  it("rejects an implausible year as a construction year", () => {
    expect(parseBuildingAge("ساخت ۵")).toEqual({ kind: "unknown", sourceText: "ساخت ۵" });
    expect(parseBuildingAge("ساخت ۹۹۹۹")).toEqual({ kind: "unknown", sourceText: "ساخت ۹۹۹۹" });
  });

  it("returns unknown for empty input", () => {
    expect(parseBuildingAge("")).toEqual({ kind: "unknown", sourceText: "" });
  });

  it("returns unknown for unrelated text", () => {
    expect(parseBuildingAge("خانه قدیمی")).toEqual({
      kind: "unknown",
      sourceText: "خانه قدیمی",
    });
  });

  it("preserves the original source text verbatim", () => {
    const input = "  ساخت ۱۴۰۲  ";
    expect(parseBuildingAge(input).sourceText).toBe(input);
  });
});
