import { describe, expect, it } from "vitest";

import { extractPreferences } from "./preferences.js";

describe("extractPreferences", () => {
  it("parses the complete example from MASTER_PROMPT §12", () => {
    const result = extractPreferences("تا ۶ میلیارد، حداقل ۱۰۰ متر، دو خواب، پارکینگ حتماً");

    expect(result.price).toEqual({ min: null, max: 6_000_000_000n, approximate: false });
    expect(result.area).toEqual({ min: 100, max: null, approximate: false });
    expect(result.bedrooms).toEqual({ min: 2, max: 2 });
    expect(result.parking).toBe("required");
  });

  it("parses a district-and-natural-language example from §14", () => {
    const result = extractPreferences(
      "یه آپارتمان ۹۰ تا ۱۱۰ متری دو خوابه توی سعادت‌آباد می‌خوام، ترجیحاً آسانسور و پارکینگ داشته باشه و تا ۱۵ میلیارد بیشتر نباشه",
    );

    expect(result.area).toEqual({ min: 90, max: 110, approximate: false });
    expect(result.bedrooms).toEqual({ min: 2, max: 2 });
    expect(result.district).toMatchObject({ canonicalName: "سعادت‌آباد" });
    expect(result.price.max).toBe(15_000_000_000n);
  });

  describe("don't-care semantics (§12, §13)", () => {
    it('"پارکینگ مهم نیست" becomes no_preference, never forbidden', () => {
      const result = extractPreferences("پارکینگ مهم نیست");
      expect(result.parking).toBe("no_preference");
    });
  });

  describe("ambiguity — never manufacturing precision (§13)", () => {
    it("a vague wish with no numbers invents nothing", () => {
      const result = extractPreferences("یه خونه خوب تو شمال تهران");

      expect(result.price).toEqual({ min: null, max: null, approximate: false });
      expect(result.area).toEqual({ min: null, max: null, approximate: false });
      expect(result.bedrooms).toEqual({ min: null, max: null });
      expect(result.district).toBeNull(); // "شمال تهران" isn't a specific seeded area
    });

    it("preserves approximate semantics from حدود", () => {
      const result = extractPreferences("حداقل حدود ۵ میلیارد");
      expect(result.price.approximate).toBe(true);
    });

    it("a bare price mention with no تا/حداقل/حداکثر is left unrecorded", () => {
      const result = extractPreferences("۵ میلیارد");
      expect(result.price).toEqual({ min: null, max: null, approximate: false });
    });
  });

  describe("attribute tri/quad-state semantics", () => {
    it("an unmentioned attribute stays unknown, not forbidden", () => {
      const result = extractPreferences("۱۲۵ متر، ۲ خواب");
      expect(result.parking).toBe("unknown");
      expect(result.elevator).toBe("unknown");
    });

    it("an explicit negative statement is forbidden", () => {
      const result = extractPreferences("بدون پارکینگ");
      expect(result.parking).toBe("forbidden");
    });

    it("a plain positive mention is required", () => {
      const result = extractPreferences("آسانسور دارد");
      expect(result.elevator).toBe("required");
    });
  });

  describe("conflicting constraints", () => {
    it("a later clause for the same field overrides an earlier one", () => {
      // Not a realistic sentence, but exercises last-stated-wins deterministically rather
      // than silently picking one arbitrarily or crashing.
      const result = extractPreferences("۲ خواب، ۳ خواب");
      expect(result.bedrooms).toEqual({ min: 3, max: 3 });
    });
  });

  describe("partial examples", () => {
    it("extracts only what is present, leaving the rest unknown", () => {
      const result = extractPreferences("دو خواب");
      expect(result.bedrooms).toEqual({ min: 2, max: 2 });
      expect(result.price).toEqual({ min: null, max: null, approximate: false });
      expect(result.area).toEqual({ min: null, max: null, approximate: false });
    });

    it("extracts a floor constraint alone", () => {
      const result = extractPreferences("طبقه ۳ به بالا نباشه، طبقه ۵");
      expect(result.floor).toEqual({ min: 5, max: 5 });
    });

    it("extracts a construction-year constraint alone", () => {
      const result = extractPreferences("ساخت ۱۴۰۰ به بعد، ساخت ۱۴۰۲");
      expect(result.buildingYear).toEqual({ min: 1402, max: 1402 });
    });
  });

  it("preserves the original source text verbatim", () => {
    const input = "دو خواب، پارکینگ دارد";
    expect(extractPreferences(input).rawText).toBe(input);
  });

  it("returns the fully-unknown structure for empty input", () => {
    const result = extractPreferences("");
    expect(result.price).toEqual({ min: null, max: null, approximate: false });
    expect(result.bedrooms).toEqual({ min: null, max: null });
    expect(result.parking).toBe("unknown");
    expect(result.district).toBeNull();
  });
});
