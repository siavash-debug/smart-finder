import { describe, expect, it } from "vitest";

import { parseAllAttributes, parseAttribute } from "./attributes.js";

describe("parseAttribute", () => {
  describe("parking", () => {
    it("is true for an explicit دارد statement", () => {
      expect(parseAttribute("parking", "پارکینگ دارد")).toBe(true);
    });

    it("is true for a bare mention (checklist style)", () => {
      expect(parseAttribute("parking", "۱۲۵ متر، پارکینگ، آسانسور")).toBe(true);
    });

    it("is false for ندارد", () => {
      expect(parseAttribute("parking", "پارکینگ ندارد")).toBe(false);
    });

    it("is false for بدون", () => {
      expect(parseAttribute("parking", "بدون پارکینگ")).toBe(false);
    });

    it("is false for فاقد", () => {
      expect(parseAttribute("parking", "فاقد پارکینگ")).toBe(false);
    });

    it("is unknown (null) when not mentioned at all — never inferred as false", () => {
      expect(parseAttribute("parking", "۱۲۵ متر، ۲ خواب")).toBeNull();
    });
  });

  describe("elevator", () => {
    it("is true for دارد", () => {
      expect(parseAttribute("elevator", "آسانسور دارد")).toBe(true);
    });

    it("is false for ندارد", () => {
      expect(parseAttribute("elevator", "آسانسور ندارد")).toBe(false);
    });

    it("is unknown when the sentence never mentions it", () => {
      expect(parseAttribute("elevator", "خانه‌ای دنج و آفتابگیر")).toBeNull();
    });
  });

  describe("storage / balcony / pool / guard / lobby / jacuzzi", () => {
    it("recognizes انباری for storage", () => {
      expect(parseAttribute("storage", "انباری دارد")).toBe(true);
      expect(parseAttribute("storage", "انباری ندارد")).toBe(false);
    });

    it("recognizes both بالکن and تراس for balcony", () => {
      expect(parseAttribute("balcony", "بالکن دارد")).toBe(true);
      expect(parseAttribute("balcony", "تراس دارد")).toBe(true);
    });

    it("recognizes استخر for pool", () => {
      expect(parseAttribute("pool", "استخر دارد")).toBe(true);
    });

    it("recognizes نگهبانی and نگهبان for guard", () => {
      expect(parseAttribute("guard", "نگهبانی دارد")).toBe(true);
      expect(parseAttribute("guard", "نگهبان ندارد")).toBe(false);
    });

    it("recognizes لابی for lobby", () => {
      expect(parseAttribute("lobby", "لابی دارد")).toBe(true);
    });

    it("recognizes جکوزی for jacuzzi", () => {
      expect(parseAttribute("jacuzzi", "جکوزی دارد")).toBe(true);
    });
  });

  describe("contradictory text", () => {
    it("returns unknown rather than guessing when both signals are present", () => {
      expect(parseAttribute("parking", "پارکینگ دارد ولی در آگهی قبلی پارکینگ ندارد")).toBeNull();
    });
  });

  describe("no false positives from unrelated substrings", () => {
    it("does not match the noun as a substring of an unrelated word", () => {
      // "پارکینگی" is a different token from "پارکینگ" and must not match.
      expect(parseAttribute("parking", "محله‌ای پارکینگی نزدیک")).toBeNull();
    });
  });
});

describe("parseAllAttributes", () => {
  it("parses every attribute from one description in a single pass", () => {
    const result = parseAllAttributes("۱۲۵ متر، ۲ خواب، پارکینگ دارد، آسانسور ندارد");
    expect(result).toEqual({
      parking: true,
      elevator: false,
      storage: null,
      balcony: null,
      pool: null,
      guard: null,
      lobby: null,
      jacuzzi: null,
    });
  });
});
