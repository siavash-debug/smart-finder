import { describe, expect, it } from "vitest";

import { parseRooms } from "./rooms.js";

describe("parseRooms", () => {
  it("parses Persian digits with خواب", () => {
    expect(parseRooms("۲ خواب")).toEqual({ kind: "exact", bedrooms: 2, sourceText: "۲ خواب" });
  });

  it("parses a Persian number word with خواب", () => {
    expect(parseRooms("دو خواب")).toEqual({ kind: "exact", bedrooms: 2, sourceText: "دو خواب" });
  });

  it("parses Latin digits with خواب", () => {
    expect(parseRooms("2 خواب")).toMatchObject({ kind: "exact", bedrooms: 2 });
  });

  it("parses the خوابه suffix form, digit and word", () => {
    expect(parseRooms("۲ خوابه")).toMatchObject({ kind: "exact", bedrooms: 2 });
    expect(parseRooms("دو خوابه")).toMatchObject({ kind: "exact", bedrooms: 2 });
  });

  it("parses اتاق as the unit", () => {
    expect(parseRooms("۳ اتاق")).toMatchObject({ kind: "exact", bedrooms: 3 });
  });

  it("parses the full اتاق خواب phrase", () => {
    expect(parseRooms("۲ اتاق خواب")).toMatchObject({ kind: "exact", bedrooms: 2 });
  });

  it("does not infer bedrooms from an unrelated number in the same phrase", () => {
    // The classic false-positive case from MASTER_PROMPT §5: a parking count must not become
    // a bedroom count just because it's a number sitting next to other listing text.
    expect(parseRooms("۱۲۵ متر، ۲ پارکینگ")).toEqual({
      kind: "unknown",
      sourceText: "۱۲۵ متر، ۲ پارکینگ",
    });
  });

  it("does not treat an area phrase as a room count", () => {
    expect(parseRooms("۱۲۵ متر")).toEqual({ kind: "unknown", sourceText: "۱۲۵ متر" });
  });

  it("returns unknown for a bare number with no unit word", () => {
    expect(parseRooms("۲")).toEqual({ kind: "unknown", sourceText: "۲" });
  });

  it("returns unknown for a unit word with no number", () => {
    expect(parseRooms("خواب")).toEqual({ kind: "unknown", sourceText: "خواب" });
  });

  it("returns unknown for empty input", () => {
    expect(parseRooms("")).toEqual({ kind: "unknown", sourceText: "" });
  });

  it("preserves the original source text verbatim", () => {
    const input = "  ۲ خواب  ";
    expect(parseRooms(input).sourceText).toBe(input);
  });
});
