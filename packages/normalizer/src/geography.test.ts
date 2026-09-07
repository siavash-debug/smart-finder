import { describe, expect, it } from "vitest";

import { resolveGeoArea } from "./geography.js";

describe("resolveGeoArea", () => {
  it("resolves a known neighborhood by its canonical spelling", () => {
    expect(resolveGeoArea("سعادت‌آباد")).toEqual({
      kind: "known",
      area: { kind: "neighborhood", canonicalName: "سعادت‌آباد" },
      sourceText: "سعادت‌آباد",
    });
  });

  it("resolves a spaced alternate spelling to the same canonical identity", () => {
    const result = resolveGeoArea("سعادت آباد");
    expect(result).toMatchObject({
      kind: "known",
      area: { canonicalName: "سعادت‌آباد" },
    });
  });

  it("resolves a district by number", () => {
    expect(resolveGeoArea("منطقه 2")).toEqual({
      kind: "known",
      area: { kind: "district", canonicalName: "منطقه 2" },
      sourceText: "منطقه 2",
    });
  });

  it("resolves a district given with Persian digits", () => {
    expect(resolveGeoArea("منطقه ۲")).toMatchObject({
      kind: "known",
      area: { kind: "district", canonicalName: "منطقه 2" },
    });
  });

  it("resolves a district alias with the city name appended", () => {
    expect(resolveGeoArea("منطقه 2 تهران")).toMatchObject({
      kind: "known",
      area: { canonicalName: "منطقه 2" },
    });
  });

  it("is insensitive to Arabic/Persian character form differences", () => {
    // "كوى نصر" using Arabic Kaf and Alef Maksura should still resolve to گیشا's alias.
    const result = resolveGeoArea("كوي نصر");
    expect(result).toMatchObject({ kind: "known", area: { canonicalName: "گیشا" } });
  });

  it("returns unknown for an unrecognized neighborhood rather than guessing", () => {
    expect(resolveGeoArea("یه محله ناشناس")).toEqual({
      kind: "unknown",
      sourceText: "یه محله ناشناس",
    });
  });

  it("returns unknown for empty input", () => {
    expect(resolveGeoArea("")).toEqual({ kind: "unknown", sourceText: "" });
  });

  it("preserves the original source text verbatim", () => {
    const input = "  سعادت‌آباد  ";
    expect(resolveGeoArea(input).sourceText).toBe(input);
  });
});
