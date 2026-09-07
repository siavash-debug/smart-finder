import { describe, expect, it } from "vitest";

import { parseNumberWordsToBigInt } from "./number-words.js";

describe("parseNumberWordsToBigInt", () => {
  it("parses a single unit word", () => {
    expect(parseNumberWordsToBigInt("دو")).toBe(2n);
    expect(parseNumberWordsToBigInt("پنج")).toBe(5n);
  });

  it("parses a compound of hundreds, tens, and units joined by و", () => {
    expect(parseNumberWordsToBigInt("صد و بیست و پنج")).toBe(125n);
  });

  it("parses a teen word", () => {
    expect(parseNumberWordsToBigInt("سیزده")).toBe(13n);
  });

  it("parses a bare scale word as one of that scale", () => {
    expect(parseNumberWordsToBigInt("میلیون")).toBe(1_000_000n);
    expect(parseNumberWordsToBigInt("هزار")).toBe(1_000n);
  });

  it("parses a unit combined with a scale word", () => {
    expect(parseNumberWordsToBigInt("پنج میلیارد")).toBe(5_000_000_000n);
    expect(parseNumberWordsToBigInt("سیصد و پنجاه میلیون")).toBe(350_000_000n);
  });

  it("parses cross-scale compounds", () => {
    expect(parseNumberWordsToBigInt("پنج میلیارد و دویست میلیون")).toBe(5_200_000_000n);
    expect(parseNumberWordsToBigInt("یک میلیون و پانصد هزار")).toBe(1_500_000n);
  });

  it("is not confused by extra whitespace", () => {
    expect(parseNumberWordsToBigInt("  صد   و   بیست  و  پنج  ")).toBe(125n);
  });

  it("returns null for an empty or separator-only phrase", () => {
    expect(parseNumberWordsToBigInt("")).toBeNull();
    expect(parseNumberWordsToBigInt("   ")).toBeNull();
    expect(parseNumberWordsToBigInt("و")).toBeNull();
  });

  it("returns null for an unrecognized word", () => {
    expect(parseNumberWordsToBigInt("چند")).toBeNull();
    expect(parseNumberWordsToBigInt("پنج خونه")).toBeNull();
  });

  it("returns null when digits are mixed into the phrase rather than words", () => {
    expect(parseNumberWordsToBigInt("۵ میلیارد")).toBeNull();
    expect(parseNumberWordsToBigInt("5 میلیارد")).toBeNull();
  });

  it("does not silently ignore a trailing unrecognized token", () => {
    expect(parseNumberWordsToBigInt("پنج میلیارد تومان")).toBeNull();
  });
});
